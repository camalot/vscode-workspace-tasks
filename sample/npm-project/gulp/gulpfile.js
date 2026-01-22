// The first step is to require Gulp and any necessary plugins.
const gulp = require('gulp');
const sass = require('gulp-sass')(require('sass')); // Using gulp-sass with the 'sass' compiler
const cleanCSS = require('gulp-clean-css');
const concat = require('gulp-concat');
const uglify = require('gulp-uglify'); // For minifying JavaScript

// Define a task to compile, clean, and pipe CSS files
function styles() {
  return gulp.src('./src/styles/**/*.scss') // Source files
    .pipe(sass().on('error', sass.logError))
    .pipe(cleanCSS({ compatibility: 'ie8' }))
    .pipe(gulp.dest('./dist/css')); // Destination folder
}

// Define a task to concatenate and minify JavaScript files
function scripts() {
  return gulp.src('./src/scripts/**/*.js') // Source files
    .pipe(concat('all.js'))
    .pipe(uglify())
    .pipe(gulp.dest('./dist/js')); // Destination folder
}

// Define a task to watch files for changes
function watchFiles() {
  gulp.watch('./src/styles/**/*.scss', styles);
  gulp.watch('./src/scripts/**/*.js', scripts);
}

// Define default task that runs all other tasks in parallel or series
// Use gulp.series() and gulp.parallel() to define task order
exports.styles = styles;
exports.scripts = scripts;
exports.watch = watchFiles;
exports.default = gulp.parallel(watchFiles, styles, scripts);
