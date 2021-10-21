"use strict";

const expect = require("chai").expect;

const { StructuredWiringBuilder, StructuredWiring } = require("../src/structured-wiring");

const ARGUMENT = (variant = "") => `Arg${variant}`;
const APP = (variant = "") => `App${variant}`;
const CONFIG = (variant = "") => `Config${variant}`;
const REQUEST = (variant = "") => `Request${variant}`;
const COMMON = (variant = "") => `Common${variant}`;

describe('structured wiring', function () {

	it('throws if scope name contains a dot', async function () {
		const builder = new StructuredWiringBuilder();

		expect(() => builder.adjustScopeContainer('Request.Goer', () => {})).to.throw(TypeError);
	});

	it('adjusts boot container', async function () {
		const wiring = makeSimpleAdjustments(new StructuredWiringBuilder()).build();

		const bootContainer = await wiring.createBootContainer(ARGUMENT());

		const config = await bootContainer.get('config');
		expect(config).to.equal(CONFIG());
		const arg = await bootContainer.get('arg');
		expect(arg).to.equal(ARGUMENT());
	});

	it('builds StructuredWiring', async function () {
		const builder = new StructuredWiringBuilder();

		const wiring = builder.build();

		expect(wiring).to.be.an.instanceOf(StructuredWiring);
	});

	it('puts StructuredWiring in containers', async function () {
		const builder = new StructuredWiringBuilder();
		const wiring = builder.build();

		const container = await wiring.createBootContainer();

		const wiringFromContainer = await container.get('wiring');
		expect(wiringFromContainer).to.be.an.instanceOf(StructuredWiring);
	});

	it('puts (adjusted) app container in boot container', async function () {
		const wiring = makeSimpleAdjustments(new StructuredWiringBuilder()).build();

		const bootContainer = await wiring.createBootContainer();

		const appContainer = await bootContainer.get('appContainer');
		const app = await appContainer.get('app');
		expect(app).to.equal(APP());
	});

	it('puts app in boot container', async function () {
		const wiring = makeSimpleAdjustments(new StructuredWiringBuilder()).build();

		const bootContainer = await wiring.createBootContainer();

		const app = await bootContainer.get('app');
		expect(app).to.equal(APP());
	});

	it('creates (adjusted) app container', async function () {
		const wiring = makeSimpleAdjustments(new StructuredWiringBuilder()).build();

		const appContainer = await wiring.createAppContainer();

		const app = await appContainer.get('app');
		expect(app).to.equal(APP());
	});

	it('puts boot container in app container', async function () {
		const wiring = makeSimpleAdjustments(new StructuredWiringBuilder()).build();

		const appContainer = await wiring.createAppContainer(ARGUMENT());

		const bootContainer = await appContainer.get('bootContainer');
		const config = await bootContainer.get('config');
		expect(config).to.equal(CONFIG());
		const arg = await bootContainer.get('arg');
		expect(arg).to.equal(ARGUMENT());
	});

	it('creates (adjusted) scope container', async function () {
		const wiring = makeSimpleAdjustments(
				new StructuredWiringBuilder(requestContainerWiring())).build();
		const appContainer = await wiring.createAppContainer();

		const requestScopeContainer = await appContainer.get('requestScopeContainer');

		const scopeAppContainer = await requestScopeContainer.get('appContainer');
		expect(scopeAppContainer).to.equal(appContainer);
		const request = await requestScopeContainer.get('request');
		expect(request).to.equal(REQUEST());
	});

	it('creates (adjusted) scope container by factory', async function () {
		const wiring = makeSimpleAdjustments(
				new StructuredWiringBuilder(requestFactoryWiring())).build();
		const appContainer = await wiring.createAppContainer();
		const createRequestScopeContainer = await appContainer.get('createRequestScopeContainer');

		const requestScopeContainer = await createRequestScopeContainer(ARGUMENT());

		const scopeAppContainer = await requestScopeContainer.get('appContainer');
		expect(scopeAppContainer).to.equal(appContainer);
		const request = await requestScopeContainer.get('request');
		expect(request).to.equal(REQUEST());
		const arg = await requestScopeContainer.get('arg');
		expect(arg).to.equal(ARGUMENT());
	});

	it('applies common scope adjustments', async function () {
		const wiring = makeSimpleAdjustments(
				new StructuredWiringBuilder(requestFactoryWiring())).build();
		const appContainer = await wiring.createAppContainer();
		const createRequestScopeContainer = await appContainer.get('createRequestScopeContainer');

		const requestScopeContainer = await createRequestScopeContainer(ARGUMENT());

		const commonAppContainer = await requestScopeContainer.get('commonAppContainer');
		expect(commonAppContainer).to.equal(appContainer);
		const common = await requestScopeContainer.get('common');
		expect(common).to.equal(COMMON());
		const arg = await requestScopeContainer.get('commonArg');
		expect(arg).to.equal(ARGUMENT());
	});

	it('imports wiring', async function () {
		const wiringToImport = makeSimpleAdjustments(
				new StructuredWiringBuilder(requestFactoryWiring())).build();

		const builder = new StructuredWiringBuilder(wiringToImport);

		const wiring = builder.build();
		await assertSimpleAdjustments(wiring);
	});

	it('adjusts wiring on boot', async function () {
		const builder = new StructuredWiringBuilder(requestFactoryWiring());

		builder.adjustWiringAfterBoot(async (addWiring) => {
			addWiring(makeSimpleAdjustments(new StructuredWiringBuilder()).build());
		});

		const wiring = builder.build();
		await assertPostBootSimpleAdjustments(wiring);
	});

	it('replaces boot wiring', async function () {
		const builder = new StructuredWiringBuilder(requestFactoryWiring());

		builder.adjustWiringAfterBoot(async (addWiring) => {
			addWiring(makeSimpleAdjustments(new StructuredWiringBuilder()).build());
		});

		makePostBootSimpleAdjustments(builder, 2, true);

		const wiring = builder.build();
		await assertPostBootSimpleAdjustments(wiring, 2);
	});

	it('replaces with boot wiring adjuster', async function () {
		/*
		 * I can't imagine any sane use case, but still this test captures expected behaviour.
		 */

		const builder = new StructuredWiringBuilder(requestFactoryWiring());

		makePostBootSimpleAdjustments(builder);

		builder.adjustWiringAfterBoot(async (addWiring) => {
			addWiring(makeSimpleAdjustments(new StructuredWiringBuilder(), 2, true).build());
		});

		const wiring = builder.build();
		await assertPostBootSimpleAdjustments(wiring, 2);
	});

});

function requestContainerWiring() {
	const builder = new StructuredWiringBuilder();

	builder.adjustAppContainer(async (container) => {
		const { register, factory, value } = container;

		register('requestScopeContainer', factory('wiring.createScopeContainer'),
				value('Request'), value(container));
	});

	return builder.build();
}

function requestFactoryWiring() {
	const builder = new StructuredWiringBuilder();

	builder.adjustAppContainer(async (container) => {
		const { register, factory, value } = container;

		register('createRequestScopeContainer', factory('wiring.createScopeContainerFactory'),
				value('Request'), value(container));
	});

	return builder.build();
}

function createInterpreter(replace) {
	return function interpret(container) {
		const { register, replacement, value } = container;

		return {
			register,
			maybeReplace: replace ? replacement : (bean) => bean,
			value
		};
	};
}

function makeSimpleAdjustments(builder, variant = "", replace = false) {
	const interpret = createInterpreter(replace);

	builder.adjustBootContainer(async function(container, arg) {
		const { register, maybeReplace, value } = interpret(container);
		register(maybeReplace('config'), value(CONFIG(variant)));
		register(maybeReplace('arg'), value(arg + variant));
	});

	return makePostBootSimpleAdjustments(builder, variant, replace);
}

function makePostBootSimpleAdjustments(builder, variant = "", replace = false) {
	const interpret = createInterpreter(replace);

	builder.adjustAppContainer(async function(container) {
		const { register, maybeReplace, value } = interpret(container);
		register(maybeReplace('app'), value(APP(variant)));
	});

	builder.adjustScopeContainer('Request', async function(container, appContainer, arg) {
		const { register, maybeReplace, value } = interpret(container);
		register(maybeReplace('appContainer'), value(appContainer));
		register(maybeReplace('request'), value(REQUEST(variant)));
		register(maybeReplace('arg'), value(arg + variant));
	});

	builder.adjustScopeContainer(async function(container, appContainer, arg) {
		const { register, maybeReplace, value } = interpret(container);
		register(maybeReplace('commonAppContainer'), value(appContainer));
		register(maybeReplace('common'), value(COMMON(variant)));
		register(maybeReplace('commonArg'), value(arg + variant));
	});

	return builder;
}

async function assertSimpleAdjustments(wiring, variant = "") {
	const bootContainer = await wiring.createBootContainer();
	const config = await bootContainer.get('config');
	expect(config).to.equal(CONFIG(variant));

	await assertPostBootSimpleAdjustments(wiring, variant, bootContainer);
}

async function assertPostBootSimpleAdjustments(wiring, variant = "", bootContainer) {
	bootContainer = bootContainer || await wiring.createBootContainer();

	const appContainer = await bootContainer.get('appContainer');
	const app = await appContainer.get('app');
	expect(app).to.equal(APP(variant));

	const createRequestScopeContainer = await appContainer.get('createRequestScopeContainer');
	const requestScopeContainer = await createRequestScopeContainer(ARGUMENT());
	const request = await requestScopeContainer.get('request');
	expect(request).to.equal(REQUEST(variant));
	const requestArg = await requestScopeContainer.get('arg');
	expect(requestArg).to.equal(ARGUMENT(variant));
	const requestCommonArg = await requestScopeContainer.get('arg');
	expect(requestCommonArg).to.equal(ARGUMENT(variant));
}

