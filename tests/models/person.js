const chai = require('chai'),
      expect = chai.expect
chai.use(require('chai-like'))
chai.use(require('chai-things')) // Don't swap these two

const faker = require('faker')
const Mongoose = require('mongoose').Mongoose
let mongoose = new Mongoose()
const Models = require('../../models/person')(mongoose),
      Person = Models.PersonModel
let CONSTANTS = {
  FAILED_LOGIN_REASONS: Models.FAILED_LOGIN_REASONS,
  OPTIONS: Models.OPTIONS
}
mongoose.Promise = Promise
// Spin up a fake mongodb instance
const MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer
const mongod = new MongoMemoryServer()

describe('Person', function() {
  let shared_email_address = null
  let shared_password = null
  let shared_first_name = null

  before(function(done) {
    mongod.getConnectionString().then((mongoUri) => {
      const mongooseOpts = { // options for mongoose 4.11.3 and above
        autoReconnect: true,
        reconnectTries: Number.MAX_VALUE,
        reconnectInterval: 1000
      };

      mongoose.connect(mongoUri, mongooseOpts);

      mongoose.connection.once('error', done);
      mongoose.connection.once('open', done);
    })
  })

  it("should create", function(done) {
    shared_email_address = faker.internet.email()
    shared_password = faker.internet.password()
    shared_first_name = faker.name.firstName()
    let person = new Person({
      email_addresses       : [{
        address       : shared_email_address
      }],
      user_info           : {
        prefix              : faker.name.prefix(),
        first_name          : shared_first_name,
        middle_name         : faker.name.firstName(),
        last_name           : faker.name.lastName(),
        gender              : faker.random.arrayElement(["Male","Female"]),
        birth_date          : faker.date.past(50, new Date("Sat Sep 20 1992 21:35:02 GMT+0200 (CEST)")),
      },
      login_info: {
        password              : shared_password,
      }
    })

    person.save(done)
    // fluffy.save().then((fluffy) => {
    //   console.log('saved!')
    //   done()
    // }).catch(done)
  })

  it("should find by email", function(done) {
    Person.findOne({"email_addresses.address": shared_email_address}).then((person) => {
      expect(person).not.to.be.null;
      expect(person.email_addresses).to.be.an('array').that.contains.something.like({address: shared_email_address});
      done()
    }).catch(done)
  })

  it("should find by first name", function(done) {
    Person.findOne({"user_info.first_name": shared_first_name}).then((person) => {
      expect(person).not.to.be.null;
      expect(person.user_info.first_name).to.be.a('string').that.equals(shared_first_name);
      done()
    }).catch(done)
  })

  describe('Authentication', function() {
    it("should fail to authenticate with incorrect email", function(done) {
      Person.getAuthenticatedByEmail(faker.internet.email(), shared_password).then((person) => {
        done("We should reject!")
      }).catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.NOT_FOUND)
        done()
      })
    })
    it("should fail to authenticate with incorrect password", function(done) {
      Person.getAuthenticatedByEmail(shared_email_address, faker.internet.password()).then((person) => {
        done("We should reject!")
      }).catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.PASSWORD_INCORRECT)
        done()
      })
    })
    it("should fail to authenticate with incorrect email and password", function(done) {
      Person.getAuthenticatedByEmail(faker.internet.email(), faker.internet.password()).then((person) => {
        done("We should reject!")
      }).catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.NOT_FOUND)
        done()
      })
    })
    it("should successfully authenticate with correct credentials", function(done) {
      Person.getAuthenticatedByEmail(shared_email_address, shared_password).then((person) => {
        expect(person).not.to.be.null;
        done()
      }).catch(done)
    })
    it("should lock account after " + CONSTANTS.OPTIONS.MAX_LOGIN_ATTEMPTS + " wrong attempts", function(done) {
      Person.getAuthenticatedByEmail(shared_email_address, faker.internet.password())
      .catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.PASSWORD_INCORRECT)
        return Person.getAuthenticatedByEmail(shared_email_address, faker.internet.password())
      }).catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.PASSWORD_INCORRECT)
        return Person.getAuthenticatedByEmail(shared_email_address, faker.internet.password())
      }).catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.PASSWORD_INCORRECT)
        return Person.getAuthenticatedByEmail(shared_email_address, faker.internet.password())
      }).catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.MAX_ATTEMPTS)
        return Person.getAuthenticatedByEmail(shared_email_address, shared_password)
        //return Person.getAuthenticatedByEmail(shared_email_address, faker.internet.password())
      }).catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.MAX_ATTEMPTS)
        done()
      })
    })
    it("should unlock locked account using unlock method", function(done) {
      Person.unlockByEmail(shared_email_address).then(() => {
        Person.getAuthenticatedByEmail(shared_email_address, shared_password)
      }).then(() => {
        done()
      })
    })
    it("should handle unlocked account using unlock method", function(done) {
      Person.unlockByEmail(shared_email_address).then(() => {
        Person.getAuthenticatedByEmail(shared_email_address, shared_password)
      }).then(() => {
        done()
      })
    })
    it("should fail with unknown account using unlock method", function(done) {
      Person.unlockByEmail(faker.internet.email()).then((person) => {
        done("We should reject!")
      }).catch((err) => {
        expect(err).to.be.a('number')
        expect(err).to.be.equal(CONSTANTS.FAILED_LOGIN_REASONS.NOT_FOUND)
        done()
      })
    })
  })

  // it("should create", function(done) {
  //
  // }

  // it("should create a person", function(done) {
  //
  //   done()
  // })

  after(function(done) {
    mongoose.disconnect(() => {
      mongod.stop()
      done()
    })
  })
})
