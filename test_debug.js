const assert = require('assert');

function getRelativePathIfInside(parentNormalized, childNormalized) {
    if (parentNormalized === childNormalized) {
      return '';
    }
    const prefix = parentNormalized.endsWith('/') ? parentNormalized : parentNormalized + '/';
    if (childNormalized.startsWith(prefix)) {
      return childNormalized.slice(prefix.length);
    }
    return undefined;
}

console.log(getRelativePathIfInside('c:/foo', 'c:/foo')); // ''
console.log(getRelativePathIfInside('c:/foo', 'c:/foo/bar')); // 'bar'
console.log(getRelativePathIfInside('c:/', 'c:/foo')); // 'foo'
console.log(getRelativePathIfInside('c:/foo', 'c:/bar')); // undefined
