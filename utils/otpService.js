const {
  TWILIO_ACCOUNT_SID: twilioAccountSid,
  TWILIO_AUTH_TOKEN: twilioAuthToken,
  TWILIO_FROM_NUMBER: twilioFromNumber,
} = process.env;

const twilioClient = null;

const generateNumericOtp = (length = 4) => {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
};

const sendOtpToPhone = async ({ countryCode = '+91', phoneNumber, otp }) => {
  const destinationNumber = `${countryCode}${phoneNumber}`;

  console.log(`[OTP] Code ${otp} would be sent to ${destinationNumber}`);
  return;
};

module.exports = {
  generateNumericOtp,
  sendOtpToPhone,
};


