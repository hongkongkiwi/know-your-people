// lastMod.js
module.exports = exports = function lastModifiedPlugin (schema, options) {
  schema.add({ last_modified: Date });

  schema.pre('save', function (next) {
    this.lastMod = new Date();
    next();
  });

  if (options && options.index) {
    schema.path('last_modified').index(options.index);
  }
}
