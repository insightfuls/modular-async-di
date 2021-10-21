"use strict";

const { StructuredWiringBuilder } = require('../..');

exports.commonWiring = function() {

	const builder = new StructuredWiringBuilder();

	builder.adjustBootContainer(async function commonWiringBootContainer(container) {
		const { register, value } = container;

		register('config', value({}));
	});

	builder.adjustAppContainer(async function commonWiringAppContainer(container) {
		const { register, bean, factory, value } = container;

		register('config', bean('bootContainer.config'));
		register('createRequestContainer', factory(bean('wiring.createScopeContainerFactory')),
				value('Request'), value(container));
	});

	builder.adjustScopeContainer(async function commonWiringAllScopes(container, appContainer) {
		const { register, value } = container;

		register('appContainer', value(appContainer));
	});

	return builder.build();

};

