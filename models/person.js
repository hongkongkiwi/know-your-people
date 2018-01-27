const Schema = require('mongoose').Schema,
      ObjectId = Schema.ObjectId,
      bcrypt = require('bcrypt'),
      moment = require('moment')

module.exports = (mongoose) => {
  // Constants for login security
  const SALT_WORK_FACTOR = 10,
        MAX_LOGIN_ATTEMPTS = 5,
        LOCK_TIME = 2 * 60 * 60 * 1000

  let models = {}

  let PersonSchema = new Schema({
      id                  : { type: ObjectId },
      email_addresses     : [{
                              address       : { type: String, required: true },
                              is_verified   : Boolean,
                            }],
      phone_numbers       : { type: Array },
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
                            },
      photos              : { type: Array, required: false },
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

  PersonSchema.statics.FAILED_LOGIN_REASONS = {
      NOT_FOUND: 0,
      PASSWORD_INCORRECT: 1,
      MAX_ATTEMPTS: 2,
      INVALID_2FACTOR: 3
  }

  PersonSchema.virtual('isLocked').get(() => {
    let person = this
    // check for a future lock_until timestamp
    return (person.login_info.lock_until && moment(person.login_info.lock_until).isBefore(moment()))
  })

  /**
    Automatically Hash the password on save (note: this is not run on update)
    **/
  PersonSchema.pre('save', (next) => {
    let person = this

    // only hash the password if it has been modified (or is new)
    if (!person.isModified('login_info.password')) return next()

    // generate a salt
    bcrypt.genSalt(SALT_WORK_FACTOR, (err, salt) => {
      if (err) return next(err)

      // hash the password along with our new salt
      bcrypt.hash(person.login_info.password, salt, (err, hash) => {
        if (err) return next(err)

        // override the cleartext password with the hashed one
        person.login_info.password = hash
        next()
      })
    })
  })

  /**
    Automatically Hash the password on save (note: this is not run on update)
    **/
  PersonSchema.methods.comparePassword = (candidatePassword, cb) => {
    let person = this
    bcrypt.compare(candidatePassword, person.login_info.password, (err, isMatch) => {
        if (err) return cb(err)
        cb(null, isMatch)
    })
  }

  /**
    This method will increment login attempts and if appropriate will lock the account
    **/
  PersonSchema.methods.incrementLoginAttempts = (cb) => {
    let person = this
    // if we have a previous lock that has expired, restart at 1
    if (person.login_info.lock_until && moment().isAfter(moment(person.login_info.lock_until))) {
        return person.update({
          login_info: {
            $set: { login_attempts: 1 },
            $unset: { lock_until: null }
          }
        }, cb)
    }
    // otherwise we're incrementing
    let updates = { $inc: { login_info: { login_attempts: 1 } } }
    // lock the account if we've reached max attempts and it's not locked already
    if (person.login_info.login_attempts + 1 >= MAX_LOGIN_ATTEMPTS && !person.isLocked) {
        updates.$set = { login_info: { lock_until: moment().add(LOCK_TIME_MINS, 'minutes') } }
    }
    return person.update(updates, cb)
  }

  /**
    Checks whether person is authenticated
    **/
  PersonSchema.statics.getAuthenticatedByEmail = (login_address, login_password, cb) => {
    this.findOne({ email_addresses: { address: login_address } }, (err, person) => {
        if (err) return cb(err)

        // make sure the user exists
        if (!person) {
          return cb(null, null, reasons.NOT_FOUND)
        }

        // check if the account is currently locked
        if (person.isLocked) {
          // just increment login attempts if account is already locked
          return person.incrementLoginAttempts((err) => {
            if (err) return cb(err)
            return cb(null, null, reasons.MAX_ATTEMPTS)
          })
        }

        // test for a matching password
        person.comparePassword(login_password, (err, isMatch) => {
            if (err) return cb(err)

            // check if the password was a match
            if (isMatch) {
              // if there's no lock or failed attempts, just return the person
              if (!person.login_info.login_attempts && !person.login_info.lock_until) return cb(null, person)
              // reset attempts and lock info
              let updates = {
                login_info: {
                  $set: { login_attempts: 0 },
                  $unset: { lock_until: null }
                }
              }
              return person.update(updates, (err) => {
                if (err) return cb(err)
                return cb(null, person)
              })
            }

            // password is incorrect, so increment login attempts before responding
            person.incrementLoginAttempts((err) => {
              if (err) return cb(err)
              return cb(null, null, reasons.PASSWORD_INCORRECT)
            })
        })
    })
  }

  models.PersonModel = mongoose.model('Person', PersonSchema)

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
  models.IdentificationModel = mongoose.model('Identification', IdentificationSchema)

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
  models.AddressModel = mongoose.model('Address', AddressSchema)

  let PhoneNumberSchema = new Schema({
      id          : ObjectId,
      person_id   : ObjectId,
      country     : String,
      number      : String,
      is_verified : Boolean,
  })
  models.PhoneNumberModel = mongoose.model('PhoneNumber', PhoneNumberSchema)

  return models
}
