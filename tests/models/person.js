const faker = require('faker')
const Mongoose = require('mongoose').Mongoose
let mongoose = new Mongoose()
const Models = require('../../models/person')(mongoose)
const Person = Models.PersonModel
mongoose.Promise = Promise
const MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer
const mongod = new MongoMemoryServer()

describe('Person', function() {
  shared_email_address = faker.internet.email()
  shared_password = faker.internet.password()

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
    let person = new Person({
      email_addresses       : [{
        address       : shared_email_address
      }],
      user_info           : {
        prefix              : faker.name.prefix(),
        first_name          : faker.name.firstName(),
        middle_name         : faker.name.firstName(),
        last_name           : faker.name.lastName(),
        gender              : faker.random.arrayElement(["Male","Female"]),
        birth_date          : faker.date.past(50, new Date("Sat Sep 20 1992 21:35:02 GMT+0200 (CEST)")),
      },
      login_info: {
        password              : shared_password,
      }
    })

    console.log(person)

    person.save(done)
    // fluffy.save().then((fluffy) => {
    //   console.log('saved!')
    //   done()
    // }).catch(done)
  })

  it("should find by email", function(done) {
    Person.findOne({email_addresses: {address: shared_email_address}}).then((person) => {
      done()
    }).catch(done)
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
