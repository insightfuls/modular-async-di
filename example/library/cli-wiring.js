"use strict";

const { StructuredWiringBuilder } = require('../..');
const { commonWiring } = require('./common-wiring');

exports.cliWiring = function() {

	const builder = new StructuredWiringBuilder(commonWiring());

	builder.adjustBootContainer(async function cliWiringBootContainer(container) {
		const { register, value } = container;

		register('cliArguments', value(process.argv.slice(2)));
	});

	return builder.build();

};


