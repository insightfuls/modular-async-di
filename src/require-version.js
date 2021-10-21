"use strict";

exports.requireVersion = function(version, pkg) {
	const semver = require('semver');

	if (!semver.satisfies(pkg.version, version)) {
		throw new RangeError(`version ${pkg.version} of ${pkg.name} does not satisfy ${version}`);
	}
};
