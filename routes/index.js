var express = require('express');
var router = express.Router();
const User = require('../models/userModel');
const Weight = require('../models/weightModel');
const { validationResult, check } = require('express-validator');
const bcrypt = require('bcrypt');
const session = require('express-session');


// Middleware to check if the user is logged in
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  } else {
    res.redirect('/login'); // Redirect to login page if not authenticated
  }
}



/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('home');
});


// get the register page
router.get('/register', (req, res, next) => { res.render('register') });
// submit the resister page and save data to db
router.post('/registerUser', [
  check('email').isEmail().withMessage('Invalid Email Address'),
  check('password').isLength({ min: 8 }).withMessage('Password must be atleast 8 characters long')
], (req, res) => {
  const errors = validationResult(req);
  const { name, email, password } = req.body;


  if (!errors.isEmpty()) {
    res.render('register', { errors: errors.array() });
  } else {
    User.findOne({ email })
      .then(existingUser => {
        if (existingUser) {
          return res.render('register', { message: 'Email Is Already Taken', error: null });
        } else {
          return bcrypt.hash(password, 10)
        }
      }).then(hashedPassword => {
        const signupUser = new User({ name, email, password: hashedPassword });
        return signupUser.save();
      }).then(() => {
        res.render('login');
      })
      .catch((error) => {
        console.error(error);
        res.render('register', {
          errors: [{ msg: 'Error saving user to the database.' }]
        });

      });
  }
}
);

// get the login page
router.get('/login', (req, res, next) => {
  res.render('login');  // Render the login page
});

router.post('/loginUser', (req, res, next) => {
  const errors = validationResult(req);  // Get validation errors

  // If there are validation errors, render the login page with errors
  if (!errors.isEmpty()) {
    return res.render('login', { message: "Invalid input data.", errors: errors.array() });
  }

  const { email, password } = req.body;

  User.findOne({ email })
    .then(user => {
      if (!user) {
        // If the user doesn't exist, send an error message
        return res.render('login', { message: "Incorrect Email Address", errors: [] });
      }

      // Compare the password with the hashed password in the database
      return bcrypt.compare(password, user.password)
        .then(isPasswordValid => {
          if (!isPasswordValid) {
            // If password is incorrect, show error
            return res.render('login', { message: "Incorrect Password", errors: [] });
          }

          // If login is successful, save user data in the session
          req.session.userId = user._id;
          req.session.userEmail = user.email;

          // Redirect to the weight dashboard after successful login
          return res.redirect('/weightDashboard');
        });
    })
    .catch(error => {
      console.error(error);
      res.status(500).send('Internal Server Error');
    });
});

router.get('/weightDashboard', isAuthenticated, (req, res) => {
  res.render('weightDashboard')
});

router.post('/addWeight', isAuthenticated, async (req, res) => {
  const weight = req.body.weight;
  const userId = req.session.userId;
  const currentDate = new Date();

  try {
    const existingWeight = await Weight.findOne({
      userId,
      date: {
        $gte: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()),
        $lte: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 23, 59, 59)
      }
    });

    if (existingWeight) {
      return res.status(400).send('You can only add one weight per day.');
    }

    const newWeight = new Weight({ weight, userId });
    await newWeight.save();
    res.redirect('/weightDashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving weight.');
  }
});

router.get('/getWeights', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId; // Get the user ID from the session

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' }); // Return an error if the user is not logged in
    }

    // Get pagination parameters from query (default page=1, limit=2)
    const { page = 1, limit = 2 } = req.query;

    // Convert page and limit to numbers
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);

    // Fetch the weights for the current page
    const weights = await Weight.find({ userId })
      .sort({ date: -1 }) // Sort by date (newest first)
      .skip((pageNumber - 1) * limitNumber) // Skip entries for previous pages
      .limit(limitNumber); // Limit the number of results per page

    // Get the total count of weights for this user
    const totalWeights = await Weight.countDocuments({ userId });

    // Calculate total pages
    const totalPages = Math.ceil(totalWeights / limitNumber);

    res.json({
      weights,
      currentPage: pageNumber,
      totalPages,
      totalWeights,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching weights.');
  }
});


router.put('/editWeight/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { weight } = req.body;

  try {
    const updatedWeight = await Weight.findByIdAndUpdate(id, { weight }, { new: true });
    res.json(updatedWeight);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error editing weight.');
  }
});

router.delete('/deleteWeight/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;

  try {
    await Weight.findByIdAndDelete(id);
    res.status(204).send(); // No content
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting weight.');
  }
});

// Route to calculate weight difference
router.get('/weight-difference', isAuthenticated, async (req, res) => {
  try {
    // Extract user ID from session or authentication middleware
    const userId = req.session.userId || req.user.id; // Adjust based on your authentication setup

    // Get startDate and endDate from query parameters
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Please provide both startDate and endDate.' });
    }

    // Convert dates to ISO format for querying
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    if (isNaN(start) || isNaN(end)) {
      return res.status(400).json({ message: 'Invalid date format.' });
    }
    console.log({ startDate, endDate });



    // Fetch weights within the date range for the logged-in user
    const weights = await Weight.find({
      userId,
      date: { $gte: start, $lte: end },
    }).sort({ date: 1 }); // Sort by date ascending
    console.log({ startDate: start, endDate: end, weights });


    if (weights.length < 2) {
      return res.status(404).json({
        message: 'Not enough weight entries found in the specified date range.',
      });
    }

    // Calculate the weight difference
    const weightDifference = weights[weights.length - 1].weight - weights[0].weight;

    res.status(200).json({
      startDate: weights[0].date,
      startWeight: weights[0].weight,
      endDate: weights[weights.length - 1].date,
      endWeight: weights[weights.length - 1].weight,
      weightDifference,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
});






router.get('/aboutus', (req, res) => { res.render('aboutus') });

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log(err);
      return res.send('Error during logout'); // Return error response if session destruction fails
    }

    // If session is successfully destroyed, redirect to login page
    res.clearCookie('connect.sid');  // Ensure cookies are also cleared
    res.redirect('/login');
  });
});






module.exports = router;
