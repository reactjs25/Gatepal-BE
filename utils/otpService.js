const http = require('http');
const https = require('https');

const {
  VINING_SMS_URI: smsUri,
  VINING_SMS_USERNAME: smsUsername,
  VINING_SMS_API_KEY: smsApiKey,
  VINING_SMS_SENDER_ID: smsSenderId,
  VINING_SMS_ROUTE: smsRoute,
  VINING_SMS_APIREQUEST: smsApiRequest = 'Text',
  VINING_SMS_FORMAT: smsFormat = 'JSON',
  VINING_SMS_SIGNUP_TEMPLATE_ID: signupTemplateId,
  VINING_SMS_FORGOT_PASSWORD_TEMPLATE_ID: forgotPasswordTemplateId,
  VINING_SMS_SIGNUP_APIREQUEST: signupApiRequest,
  VINING_SMS_FORGOT_PASSWORD_APIREQUEST: forgotPasswordApiRequest,
  VINING_SMS_SIGNUP_MESSAGE_TEMPLATE:
    signupMessageTemplate = '{otp} is your GatePal OTP to verify mobile number. Valid for {validityMins} mins. Do not share this code with anyone. If not requested please ignore. Team GatePal',
  VINING_SMS_FORGOT_PASSWORD_MESSAGE_TEMPLATE:
    forgotPasswordMessageTemplate = '{otp} is GatePal OTP to reset password. Valid for {validityMins} mins. Don’t share this code with anyone. If not requested, ignore message. Team GatePal',
} = process.env;

const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10);

const TEMPLATE_TYPES = {
  SIGNUP: 'signup',
  FORGOT_PASSWORD: 'forgot_password',
};

const generateNumericOtp = (length = 4) => {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
};

const getTemplateConfig = (templateType) => {
  if (templateType === TEMPLATE_TYPES.FORGOT_PASSWORD) {
    return {
      templateId: forgotPasswordTemplateId,
      messageTemplate: forgotPasswordMessageTemplate,
      apiRequest: forgotPasswordApiRequest || smsApiRequest,
    };
  }

  return {
    templateId: signupTemplateId,
    messageTemplate: signupMessageTemplate,
    apiRequest: signupApiRequest || smsApiRequest,
  };
};

const buildMessage = (messageTemplate, values) => {
  let message = messageTemplate;

  Object.entries(values).forEach(([key, value]) => {
    message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  });

  return message;
};

const buildMobileNumber = ({ countryCode = '+91', phoneNumber }) => {
  const normalizedPhoneNumber = String(phoneNumber || '').replace(/\D/g, '');
  const normalizedCountryCode = String(countryCode || '').replace(/\D/g, '');

  if (!normalizedPhoneNumber) {
    throw new Error('Phone number is required to send OTP.');
  }

  return normalizedCountryCode === '91'
    ? normalizedPhoneNumber
    : `${normalizedCountryCode}${normalizedPhoneNumber}`;
};

const postFormData = (targetUrl, formData) => {
  const parsedUrl = new URL(targetUrl);
  const requestBody = new URLSearchParams(formData).toString();
  const client = parsedUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (response) => {
        let responseBody = '';

        response.on('data', (chunk) => {
          responseBody += chunk;
        });

        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 400) {
            reject(
              new Error(
                `Vining SMS API request failed with status ${response.statusCode}: ${responseBody || 'No response body'}`
              )
            );
            return;
          }

          resolve(responseBody);
        });
      }
    );

    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });
};

const sendOtpToPhone = async ({ countryCode = '+91', phoneNumber, otp, templateType = TEMPLATE_TYPES.SIGNUP }) => {
  const requiredConfig = {
    smsUri,
    smsUsername,
    smsApiKey,
    smsSenderId,
    smsRoute,
  };

  const missingConfig = Object.entries(requiredConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingConfig.length > 0) {
    throw new Error(`Missing SMS configuration: ${missingConfig.join(', ')}`);
  }

  const { templateId, messageTemplate, apiRequest } = getTemplateConfig(templateType);
  if (!templateId) {
    throw new Error(`Missing SMS template ID for template type: ${templateType}`);
  }

  const mobile = buildMobileNumber({ countryCode, phoneNumber });
  const validityMins = Math.max(1, Math.round(OTP_TTL_IN_MS / 60000));
  const message = buildMessage(messageTemplate, {
    otp,
    validityMins,
  });

  const responseBody = await postFormData(smsUri, {
    username: smsUsername,
    apikey: smsApiKey,
    apirequest: apiRequest,
    sender: smsSenderId,
    route: smsRoute,
    format: smsFormat,
    message,
    mobile,
    TemplateID: templateId,
  });

  console.log(`[OTP] SMS sent to ${mobile}: ${responseBody}`);
};

module.exports = {
  generateNumericOtp,
  sendOtpToPhone,
  TEMPLATE_TYPES,
};


