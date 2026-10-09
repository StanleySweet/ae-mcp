// ES3 polyfills for the AE bridge (ExtendScript). Strict ES3:
// var only, no arrow functions, no template strings, no Array extras.
(function () {
    'use strict';
    var ap = Array.prototype;
    var hasOwn = Object.prototype.hasOwnProperty;

    function forEach(callback, thisArg) {
        if (typeof callback !== 'function') {
            throw new TypeError('forEach: callback must be a function');
        }
        var i, length = this.length;
        for (i = 0; i < length; i++) {
            if (i in this) {
                callback.call(thisArg, this[i], i, this);
            }
        }
    }

    function map(callback, thisArg) {
        if (typeof callback !== 'function') {
            throw new TypeError('map: callback must be a function');
        }
        var out = [], i, length = this.length;
        for (i = 0; i < length; i++) {
            if (i in this) {
                out[i] = callback.call(thisArg, this[i], i, this);
            }
        }
        return out;
    }

    function filter(callback, thisArg) {
        if (typeof callback !== 'function') {
            throw new TypeError('filter: callback must be a function');
        }
        var out = [], i, length = this.length;
        for (i = 0; i < length; i++) {
            if (i in this && callback.call(thisArg, this[i], i, this)) {
                out.push(this[i]);
            }
        }
        return out;
    }

    function indexOf(search, fromIndex) {
        var i, length = this.length;
        if (typeof fromIndex === 'number' && fromIndex > 0) {
            i = Math.min(Math.floor(fromIndex), length);
        } else {
            i = 0;
        }
        for (; i < length; i++) {
            if (i in this && this[i] === search) {
                return i;
            }
        }
        return -1;
    }

    function trim() {
        return String(this).replace(/^\s+/, '').replace(/\s+$/, '');
    }

    if (!ap.forEach) { ap.forEach = forEach; }
    if (!ap.map) { ap.map = map; }
    if (!ap.filter) { ap.filter = filter; }
    if (!ap.indexOf) { ap.indexOf = indexOf; }
    if (!String.prototype.trim) { String.prototype.trim = trim; }

    function keys(object) {
        var out = [], key;
        for (key in object) {
            if (hasOwn.call(object, key)) {
                out.push(key);
            }
        }
        return out;
    }

    if (!Object.keys) { Object.keys = keys; }
}());