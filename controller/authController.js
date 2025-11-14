const jwt = require('jsonwebtoken');

const signIn = async (req, res) => {
  const { email, password } = req.body;

  const ADMIN_EMAIL = 'admin@society.com';
  const ADMIN_PASSWORD = 'admin123';

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { email: ADMIN_EMAIL, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );


  return res.status(200).json({
    message: 'Admin login successful',
    data: { email: ADMIN_EMAIL, role: 'admin' },
    token,
  });
};

module.exports = { signIn };
