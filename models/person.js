const Mongoose = require('singleton-require')('mongoose'),
      crate = require('mongoose-crate'),
      LocalFS = require('mongoose-crate-localfs'),
      Schema = Mongoose.Schema,
      ObjectId = Schema.ObjectId,
      bcrypt = require('bcrypt'),
      moment = require('moment'),
      util = require('util'),
      _ = require('underscore'),
      debug = require('debug')('models:person'),
      appRoot = require('app-root-path'),
      secureRandom = require('secure-random-string')

require('mongoose-type-email')
const EmailType = Mongoose.SchemaTypes.Email

let models = {}

models.FAILED_LOGIN_REASONS = {
    NOT_FOUND: 0,
    PASSWORD_INCORRECT: 1,
    MAX_ATTEMPTS: 2,
    ADMIN_LOCKED: 3,
    UNVERIFIED_EMAIL: 4,
    UNVERIFIED_PHONE: 5,
    INVALID_SMS_2FACTOR: 6,
    INVALID_HOTP_2FACTOR: 7
}

models.FAILED_VERIFICATION_REASONS = {
    NOT_FOUND: 0,
    CODE_EMPTY: 1,
    CODE_INCORRECT: 2,
    NO_CODE_GENERATED: 3,
    //PERSON_LOCKED: 4,
}

// Constants for login security
models.OPTIONS = {
  RANDOM_HASH_LENGTH: 64,
  SALT_WORK_FACTOR: 10,
  MAX_LOGIN_ATTEMPTS: 3,
  LOCK_TIME_SECS: 10, // 2 * 60 * 60 * 1000
}

let PersonSchema = new Schema({
    id                  : { type: ObjectId },
    email_addresses     : [{
                            address                   : { type: EmailType, required: true, unique: true, index: true },
                            verification_code         : { type: String, default: null },
                            verification_code_issued  : { type: Date, default: null },
                            is_verified               : Boolean,
                          }],
    phone_numbers     : [{
                            country       : String,
                            number        : { type: EmailType, required: true, unique: true, index: true },
                            is_verified   : Boolean,
                          }],
    identifications     : { type: Array },
    addresses           : {
                            type     : Array,
                            required : false,
                            validate : {
                              validator: (array) => {
                                return array.every((v) => typeof v === ObjectId)
                              }
                            }
                          },
    login_info          : {
                            password        : { type: String, required: true },
                            login_attempts  : { type: Number, required: false, default: 0 },
                            lock_until      : { type: Date, required: false, default: null },
                            is_admin_locked    : { type: Boolean, default: false }
                            last_logged_ip_v4 : { type: String: default null }
                          },
    user_info           : {
                            suffix      : { type: String, required: false },
                            first_name  : { type: String, required: true },
                            middle_name : { type: String, required: false },
                            last_name   : { type: String, required: true },
                            birth_date  : { type: Date, required: true },
                            gender      : { type: String, enum: ['Male', 'Female'] },
                          },
    // is_verified         : { type: Boolean, default: false },
  })

/** Load our plugins **/
PersonSchema.plugin(require('./plugins/lastModified'), { index: false });
PersonSchema.plugin(crate, {
  storage: new LocalFS({
    directory: appRoot + '/uploads'
  }),
  fields: {
    attachments: {
      array: true
    }
  }
})

PersonSchema.virtual('isLocked').get(function() {
  let person = this
  // check for a future lock_until timestamp
  return (!_.isNull(person.login_info.lock_until) && moment().isBefore(moment(person.login_info.lock_until)))
})

// PersonSchema.virtual('isVerifiedEmail').get(function() {
//   return _.find(person.email_addresses, function(email_address) { return email_address.is_verified }) || false
// })
//
// PersonSchema.virtual('isVerifiedPhone').get(function() {
//   return _.find(person.phone_numbers, function(phone_number) { return phone_number.is_verified }) || false
// })

/**
  Automatically Hash the password on save (note: this is not run on update)
  **/
PersonSchema.pre('save', function(next) {
  let person = this

  // only hash the password if it has been modified (or is new)
  if (person.isModified('login_info.password')) {
    // generate a salt
    return bcrypt.genSalt(models.OPTIONS.SALT_WORK_FACTOR, (err, salt) => {
      if (!_.isNull(err) && !_.isUndefined(err)) return next(err)

      // hash the password along with our new salt
      bcrypt.hash(person.login_info.password, salt, (err, hash) => {
        if (!_.isNull(err) && !_.isUndefined(err)) return next(err)

        // override the cleartext password with the hashed one
        person.login_info.password = hash
        next()
      })
    })
  } else if (person.isModified('email_addresses')) {
    for (var i = 0; i < person.email_addresses.length; i++) {
      if (!person.isModified('email_addresses.' + i)) {
        continue
      }
      if (person.isModified('email_addresses.' + i + '.verification_code')) {
        if (_.isNull(person.email_addresses[i].verification_code)) {
          person.email_addresses[i].verification_code_issued = null
        } else {
          person.email_addresses[i].verification_code_issued = moment().toDate()
        }
      }
      if (person.isModified('email_addresses.' + i + '.is_verified') && person.email_addresses[i].is_verified) {
        person.email_addresses[i].verification_code = null
        person.email_addresses[i].verification_code_issued = null
      }
    }
  }

  return next()
})

/**
  Automatically Hash the password on save (note: this is not run on update)
  **/
PersonSchema.methods.comparePassword = function(candidatePassword) {
  return new Promise((resolve, reject) => {
    let person = this
    if (!candidatePassword) return cb(null, false)

    bcrypt.compare(candidatePassword, person.login_info.password, (err, isMatch) => {
      if (!_.isNull(err) && !_.isUndefined(err)) return reject(err)
      resolve(isMatch)
    })
  })
}

/**
  This method will increment login attempts and if appropriate will lock the account
  **/
PersonSchema.methods.incrementLoginAttempts = function() {
  let person = this
  const funcName = "incrementLoginAttempts"
  return new Promise((resolve, reject) => {
    // if we have a previous lock that has expired, restart at 1
    if (!_.isNull(person.login_info.lock_until) && moment().isAfter(moment(person.login_info.lock_until))) {
      return person.update({
        $set: { "login_info.login_attempts": 1 },
        $set: { "login_info.lock_until": null }
      }).then(resolve).catch(reject)
    }
    // otherwise we're incrementing
    let updates = {}
    updates.$inc = { "login_info.login_attempts": 1 }
    //debug(funcName, {"login_info.login_attempts": person.login_info.login_attempts + 1})
    // lock the account if we've reached max attempts and it's not locked already
    if ((person.login_info.login_attempts + 1) >= models.OPTIONS.MAX_LOGIN_ATTEMPTS && !person.isLocked) {
      updates.$set = { "login_info.lock_until": moment().add(models.OPTIONS.LOCK_TIME_SECS, 'seconds').toDate() }
      //debug(funcName, {"login_info.lock_until": updates.$set["login_info.lock_until"]})
    }
    person.update(updates).then(resolve).catch(reject)
  })
}

/**
  Checks whether person is authenticated
  **/
PersonSchema.statics.getAuthenticatedByEmail = function(login_address, login_password) {
  const funcName = 'getAuthenticatedByEmail'
  debug(funcName,"AUTH",login_address)

  return new Promise((resolve, reject) => {
    this.findOne({ "email_addresses.address": login_address }).then((person) => {
      // make sure the PERSON exists
      if (_.isNull(person) || _.isUndefined(person)) {
        debug(funcName,"ERROR: PERSON NOT FOUND")
        return reject(models.FAILED_LOGIN_REASONS.NOT_FOUND)
      }

      // check if the account is currently locked by admin
      if (person.user_info.is_admin_locked) {
        debug(funcName,"ERROR: PERSON IS ADMIN LOCKED")
        return reject(models.FAILED_LOGIN_REASONS.ADMIN_LOCKED)
      }

      // check if the account is currently locked
      if (person.isLocked) {
        // just increment login attempts if account is already locked
        return person.incrementLoginAttempts().then((loginAttempts) => {
          debug(funcName,"ERROR: PERSON IS LOCKED")
          reject(models.FAILED_LOGIN_REASONS.MAX_ATTEMPTS)
        })
      }

      // test for a matching password
      person.comparePassword(login_password).then((isMatch) => {
        if (!isMatch) {
          // password is incorrect, so increment login attempts before responding
          return person.incrementLoginAttempts().then(() => {
            //if (!_.isNull(err) && !_.isUndefined(err)) { debug(funcName,"ERROR:",err) return cb(err) }
            debug(funcName,"ERROR: PASSWORD INCORRECT")
            reject(models.FAILED_LOGIN_REASONS.PASSWORD_INCORRECT)
          })
        }

        // if there's no lock or failed attempts, just return the person
        if (person.login_info.login_attempts === 0 && _.isNull(person.login_info.lock_until)) {
          debug(funcName,"AUTH SUCCESS")
          return resolve(person)
        }
        // reset attempts and lock info
        let updates = {
          $set: {
            "login_info.login_attempts": 0,
            "login_info.lock_until": null
          }}
        person.update(updates).then(() => {
          debug(funcName,"AUTH SUCCESS")
          return resolve(person)
        })
      })
    })
  })
}

PersonSchema.statics.generateEmailVerificationCode = function(email_address) {
  const funcName = "generateEmailVerificationCode"
  return new Promise((resolve, reject) => {
    this.findOne({ "email_addresses.address": email_address}).then((person) => {
      // make sure the PERSON exists
      if (_.isNull(person) || _.isUndefined(person)) {
        debug(funcName,"ERROR: PERSON NOT FOUND")
        return reject(models.FAILED_VERIFICATION_REASONS.NOT_FOUND)
      }
      secureRandom({length: models.OPTIONS.RANDOM_HASH_LENGTH, alphanumeric: true}, function(err, sr) {
        if (err) return reject(err)
        let addr_idx = -1
        for (var i = 0; i < person.email_addresses.length; i++) {
          if (person.email_addresses[i].address === email_address) {
            addr_idx = i
            break
          }
        }
        person.email_addresses[addr_idx].verification_code = sr
        debug(funcName,"EMAIL VERIFICATION CODE GENERATED", email_address, sr)
        person.save().then(() => {
          resolve(sr)
        }).catch(reject)
      });
    })
  })
}

PersonSchema.statics.verifyWithCode = function(verification_code) {
  const funcName = "verifyWithCode"
  return new Promise((resolve, reject) => {
    if (_.isNull(verification_code) || _.isUndefined(verification_code)) {
      debug(funcName, "ERROR: BLANK VERIFICATION CODE")
      return reject(models.FAILED_VERIFICATION_REASONS.CODE_EMPTY)
    }
    this.findOne({ "email_addresses.verification_code": verification_code}).then((person) => {
      // make sure the PERSON exists
      if (_.isNull(person) || _.isUndefined(person)) {
        debug(funcName,"ERROR: PERSON NOT FOUND")
        return reject(models.FAILED_VERIFICATION_REASONS.CODE_INCORRECT)
      }

      // check if the account is currently locked
      // if (!person.isLocked) {
      //   debug(funcName,"ERROR: PERSON IS LOCKED")
      //   return reject(models.FAILED_VERIFICATION_REASONS.PERSON_LOCKED)
      // }

      let addr_idx = -1
      for (var i = 0; i < person.email_addresses.length; i++) {
        if (person.email_addresses[i].address === email_address) {
          addr_idx = i
          break
        }
      }

      if (_.isNull(person.email_addresses[addr_idx].verification_code) || _.isUndefined(person.email_addresses[addr_idx].verification_code)) {
        debug(funcName, "ERROR: NO VERIFICATION CODE GENERATED")
        return reject(models.FAILED_VERIFICATION_REASONS.NO_CODE_GENERATED)
      }

      if (person.email_addresses[addr_idx].verification_code === verification_code) {
        const key = "email_addresses[" + addr_idx + "].is_verified"
        let updates = {$set: {}}
        updates.$set[key] = true

        person.update(updates).then(() => {
          debug(funcName, "EMAIL VERIFICATION SUCCESS", email_address)
          return resolve()
        })
      } else {
        debug(funcName, "ERROR: INVALID VERIFICATION CODE", email_address)
        return reject(models.FAILED_VERIFICATION_REASONS.CODE_INCORRECT)
      }
    })
  })
}

PersonSchema.statics.unlockByEmail = function(login_address) {
  const funcName = "unlockByEmail"
  return new Promise((resolve, reject) => {
    this.findOne({ "email_addresses.address": login_address }).then((person) => {
      // make sure the PERSON exists
      if (_.isNull(person) || _.isUndefined(person)) {
        debug(funcName,"ERROR: PERSON NOT FOUND")
        return reject(models.FAILED_LOGIN_REASONS.NOT_FOUND)
      }

      // check if the account is currently locked
      if (!person.isLocked) {
        debug(funcName,"WARN: PERSON IS ALREADY UNLOCKED")
        return resolve(true)
      }

      const updates = {
        $set: {
          "login_info.login_attempts": 0,
          "login_info.lock_until": null
        }}
      person.update(updates).then(() => {
        debug(funcName,"UNLOCK SUCCESS")
        return resolve()
      })
    })
  })
}

let EmailVerificationSchema = new Schema({
    id                  : ObjectId,
    person_id           : ObjectId,
    email_address       : String,
    code_issued         : Date,
    code                : String,
})

EmailVerificationSchema.statics.verify = (code) => {

})

let PhoneVerificationSchema = new Schema({
    id                  : ObjectId,
    person_id           : ObjectId,
    country             : String,
    phone_number        : String,
    code_issued         : Date,
    code                : String,
})

PhoneVerificationSchema.statics.verify = (code) => {

})

let IdentificationSchema = new Schema({
    id                  : ObjectId,
    person_id           : ObjectId,
    id_number           : String,
    id_issuance         : Date,
    id_expiry           : Date,
    id_type             : String,
    images              : Array,
    is_verified         : Boolean,
})


let AddressSchema = new Schema({
    id                        : ObjectId,
    person_id                 : ObjectId,
    address1                  : String,
    address2                  : String,
    address3                  : String,
    city                      : String,
    state                     : String,
    zip                       : String,
    country                   : String,
    is_country_of_residence   : Boolean,
    is_country_of_citizenship : Boolean,
    images                    : Array,
})

module.exports = exports = function(mongoose) {
  models.AddressModel = mongoose.model('Address', AddressSchema)
  models.PersonModel = mongoose.model('Person', PersonSchema)
  models.IdentificationModel = mongoose.model('Identification', IdentificationSchema)
  return models
}
