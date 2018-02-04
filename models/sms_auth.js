const appRoot = require('app-root-path'),
      path = require('path'),
      templatesDir = path.join(appRoot.toString(),'templates')
process.env.NODE_CONFIG_DIR = path.join(appRoot.toString(),"config")
const Mongoose = require('singleton-require')('mongoose'),
      Schema = Mongoose.Schema,
      ObjectId = Schema.ObjectId,
      moment = require('moment'),
      config = require('config'),
      plivo = require('plivo'),
      _ = require('underscore'),
      debug = require('debug')('MODELS:SMSAuth'),
      tmplCompile = require("string-template/compile"),
      uniqueRandom = require('unique-random')

let randNum = uniqueRandom(1, 9)
let smsAuthTemplate = tmplCompile(path.join(templatesDir,'sms-auth.txt'))
let plivoClient = new plivo.Client(config.get('Plivo.AuthID'), config.get('Plivo.AuthToken'))

let models = {}

/** Options **/
models.OPTIONS = {
  AUTH_CODE_LENGTH: 5
}

/** Helper Functions **/
function makeCode(length) {
  let auth_code = ""
  for(var i = 0; i < length; i++) {
    auth_code += randNum()
  }
  return auth_code
}

function isBlank(variable) {
  return _.isNull(variable) || _.isUndefined(variable)
}

function sendSMS(phone_number, code) => {
  plivoClient.messages.create(
    config.get('Plivo.SMSNumber'),
    phone_number,
    smsAuthTemplate(code)
  ).then(function(message_created) {
    if (message_created)
      debug("sendSMS", "Sent SMS to", phone_number)
    else
      debug("sendSMS", "Failed to send SMS to", phone_number)
  })
}

/** Base Schema **/
let SMSVerificationSchema = new Schema({
    id                  : ObjectId,
    person_id           : ObjectId,
    phone_number        : { type: String, required: true },
    auth_code           : {
      issued_date : { type: String, default: Date.now(), required: false },
      code : { type: String, defalult: makeCode, required: false }
    }
})

/** Static Methods **/
SMSVerificationSchema.statics.checkCode = function(code) {
  return SMSVerificationSchema.findOne({"auth_code.code": code}).then((smsVerification) => {
    if (isBlank(smsVerification))
      return null
    else
      return smsVerification.person_id
  })
}

SMSVerificationSchema.statics._sendSMS = sendSMS

module.exports = exports = function(mongoose) {
  models.SMSVerificationSchema = mongoose.model('SMSVerification', SMSVerificationSchema)
  return models
}
