"use strict";

const { StructuredWiringBuilder } = require('..');
const { cliWiring } = require('./library/cli-wiring');
const { consoleWiring } = require('./library/console-wiring');
const modules = require('./modules');

const builder = new StructuredWiringBuilder();

builder.adjustBaseWiring(async function helloWorldBaseWiring(addWiring) {
	addWiring(cliWiring());
});

builder.adjustBootContainer(async function helloWorldBootContainer(container, bootOptions) {
	const { register, factory, value } = container;

	register('config.cli', factory(modules.parseCommandLine), 'cliArguments');
	register('config.colours', value({ emphasis: bootOptions.emphasisColour }));
});

builder.adjustWiringAfterBoot(async function helloWorldBootWiring(addWiring, bootContainer) {
	const config = await bootContainer.get('config');

	addWiring(consoleWiring({
		useColour: config.cli.useColour,
		emphasisColour: config.colours.emphasis
	}));
});

builder.adjustAppContainer(async function helloWorldAppContainer(container) {
	const { register, bean, constructor } = container;

	register('app', constructor(modules.App),
			bean('config.cli'), bean('createRequestContainer'));
});

builder.adjustScopeContainer('Request', async function helloWorldRequestScope(container, appContainer, name) {
	const { register, bean, constructor, bound, value } = container;

	register('greeter', constructor(modules.Greeter),
			bound('console.log'), bean('appContainer.emphasise'), value(name));
});

module.exports = builder.build();
