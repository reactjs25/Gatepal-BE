const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const validator = require('validator');

const superAdminSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
        message: 'Invalid email address',
      },
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

superAdminSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const saltRounds = 10;
    const salt = await bcrypt.genSalt(saltRounds);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (error) {
    return next(error);
  }
});

superAdminSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('SuperAdmin', superAdminSchema);

