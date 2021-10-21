"use strict";

const { StructuredWiringBuilder } = require('..');
const modules = require('./modules');
const chalk = require('chalk');

const builder = new StructuredWiringBuilder();

builder.adjustBootContainer(async function helloWorldBootContainer(container, bootOptions) {
	const { register, factory, value } = container;

	register('config', factory(modules.parseCommandLine), 'cliArguments');
	register('config.emphasisColour', value(bootOptions.emphasisColour));
	register('cliArguments', value(process.argv.slice(2)));
});

builder.adjustAppContainer(async function helloWorldAppContainer(container, bootContainer) {
	const { register, bean, constructor, factory, value } = container;

	register('app', constructor(modules.App),
			bean('config'), bean('createRequestContainer'));
	register('config', bean('bootContainer.config'));
	register('createRequestContainer', factory(bean('wiring.createScopeContainerFactory')),
			value('Request'), value(container));
	register('console', value(console));

	const config = await bootContainer.get('config');
	if (config.useColour) {
		register('emphasise', factory((emphasisColour) => chalk[emphasisColour]),
				bean('config.emphasisColour'));
	} else {
		register('emphasise', value((text) => text));
	}
});

builder.adjustScopeContainer('Request', async function helloWorldRequestScope(container, appContainer, name) {
	const { register, bean, constructor, bound, value } = container;

	register('appContainer', value(appContainer));
	register('greeter', constructor(modules.Greeter),
			bound('console.log'), bean('appContainer.emphasise'), value(name));
	register('console', bean('appContainer.console'));
});

module.exports = builder.build();
