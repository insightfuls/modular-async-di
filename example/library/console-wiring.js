"use strict";

const { StructuredWiringBuilder, requireVersion } = require('../..');

exports.consoleWiring = function(options) {

	let chalk;
	if (options.useColour) {
		const chalkPkg = require('chalk/package');
		requireVersion("^4.0.0", chalkPkg);
		chalk = require('chalk');
	}

	const builder = new StructuredWiringBuilder();

	builder.adjustAppContainer(async function consoleWiringAppContainer(container) {
		const { register, factory, value } = container;

		register('console', value(console));

		if (options.useColour) {
			register('emphasise', factory((emphasisColour) => chalk[emphasisColour]),
					value(options.emphasisColour));
		} else {
			register('emphasise', value((text) => text));
		}
	});

	builder.adjustScopeContainer(async function consoleWiringAllScopes(container) {
		const { register, bean } = container;

		register('console', bean('appContainer.console'));
	});

	return builder.build();

};

