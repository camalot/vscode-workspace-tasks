const gulp = require('gulp');

// gulp.task() style
gulp.task('classic-build', function() {
  return Promise.resolve();
});
gulp.task('classic-test', function() {
  return Promise.resolve();
});
gulp.task("classic-deploy", function() {
  return Promise.resolve();
});

// module.exports style
module.exports.moduleExportsTask = function() {
  return Promise.resolve();
};

// exports style
exports.exportsTask = function() {
  return Promise.resolve();
};
