const gulp = require('gulp');

function buildSass() {
  return Promise.resolve();
}

function buildJs() {
  return Promise.resolve();
}

const minify = () => Promise.resolve();

// gulp.series with string names and identifier references
exports.build = gulp.series('build-css', buildSass, buildJs);

// gulp.parallel with string names
exports.watch = gulp.parallel('watch-css', 'watch-js');

// series with identifiers that resolve to declarations
exports.release = gulp.series(buildJs, minify);
