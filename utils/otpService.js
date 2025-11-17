const twilio = require('twilio');

const {
  TWILIO_ACCOUNT_SID: twilioAccountSid,
  TWILIO_AUTH_TOKEN: twilioAuthToken,
  TWILIO_FROM_NUMBER: twilioFromNumber,
} = process.env;

const twilioClient =
  twilioAccountSid && twilioAuthToken ? twilio(twilioAccountSid, twilioAuthToken) : null;

const generateNumericOtp = (length = 4) => {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
};

const sendOtpToPhone = async ({ countryCode = '+91', phoneNumber, otp }) => {
  const destinationNumber = `${countryCode}${phoneNumber}`;

  if (!twilioClient || !twilioFromNumber) {
    console.warn('[OTP] Twilio credentials missing. OTP sending skipped.');
    console.log(`[OTP] Code ${otp} would be sent to ${destinationNumber}`);
    return;
  }

  await twilioClient.messages.create({
    body: `Your GatePal verification code is ${otp}`,
    from: twilioFromNumber,
    to: destinationNumber,
  });
};

module.exports = {
  generateNumericOtp,
  sendOtpToPhone,
};


