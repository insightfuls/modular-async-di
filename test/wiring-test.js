"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;

const { WiringBuilder, Wiring } = require("../src/wiring");

const STUB_VALUE = "stump";
const ANOTHER_VALUE = "trunk";
const THIRD_VALUE = "branches";

describe('wiring', function () {

	describe('basic', function () {

		it('throws creating container without type provided', async function () {
			const wiring = new WiringBuilder().build();

			await expect(wiring.createContainer()).to.eventually.be.rejectedWith(TypeError);
		});

		it('throws creating nonexistent container', async function () {
			const wiring = new WiringBuilder().build();

			await expect(wiring.createContainer('Test')).to.eventually.be.rejectedWith(RangeError);
		});

		it('throws creating container factory without type provided', async function () {
			const wiring = new WiringBuilder().build();

			await expect(wiring.createContainerFactory()).to.eventually.be.rejectedWith(TypeError);
		});

		it('throws creating factory for nonexistent container', async function () {
			const wiring = new WiringBuilder().build();

			await expect(wiring.createContainerFactory('Test')).to.eventually.be.rejectedWith(RangeError);
		});

		it('creates container with wiring', async function () {
			const wiring = builderWithContainerType('Test').build();

			const container = await wiring.createContainer('Test');

			const wiringFromContainer = await container.get('wiring');
			expect(wiringFromContainer).to.be.an.instanceof(Wiring);
		});

	});

	describe('for container adjusters', function () {

		it('throws adjusting container without type provided', async function () {
			const builder = new WiringBuilder();

			expect(() => builder.adjustContainer(() => {})).to.throw(TypeError);
		});

		it('throws adjusting container with invalid adjuster provided', async function () {
			const builder = new WiringBuilder();

			expect(() => builder.adjustContainer('Test', 'Child', () => {})).to.throw(TypeError);
		});

		it('passes arguments to adjuster when creating container', async function () {
			const builder = new WiringBuilder();
			builder.adjustContainer('Test', async (container, something) => {
				const { register, value } = container;
				register('bean', value(something));
			});
			const wiring = builder.build();

			const container = await wiring.createContainer('Test', STUB_VALUE);

			await assertBeans(container, {
				"bean": STUB_VALUE
			});
		});

		it('passes both factory and caller arguments to adjuster', async function () {
			const builder = new WiringBuilder();
			builder.adjustContainer('Test', async (container, something, more) => {
				const { register, value } = container;
				register('bean', value(something));
				register('another', value(more));
			});
			const wiring = builder.build();

			const factory = await wiring.createContainerFactory('Test', STUB_VALUE);
			const container = await factory(ANOTHER_VALUE);

			await assertBeans(container, {
				"bean": STUB_VALUE,
				"another": ANOTHER_VALUE
			});
		});

		it('adjusts twice in correct order', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test', registerBeans({'bean': STUB_VALUE}));
			builder.adjustContainer('Test', replaceBeans({'bean': ANOTHER_VALUE}));

			await buildAndAssertBeans(builder, 'Test', {
				"bean": ANOTHER_VALUE
			});
		});

		it('includes ancestor adjusters when creating new container type', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test', registerBeans({'parent': STUB_VALUE}));
			builder.adjustContainer('Test.Child', registerBeans({'child': ANOTHER_VALUE}));
			builder.adjustContainer('Test.Child.Grandchild',
					registerBeans({'grandchild': THIRD_VALUE}));

			await buildAndAssertBeans(builder, 'Test.Child.Grandchild', {
				"parent": STUB_VALUE,
				"child": ANOTHER_VALUE,
				"grandchild": THIRD_VALUE
			});
		});

		it('includes ancestor adjusters when a generation is missing', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test', registerBeans({'parent': STUB_VALUE}));
			builder.adjustContainer('Test.Child.Grandchild',
					registerBeans({'grandchild': ANOTHER_VALUE}));

			await buildAndAssertBeans(builder, 'Test.Child.Grandchild', {
				"parent": STUB_VALUE,
				"grandchild": ANOTHER_VALUE
			});
		});

		it('adjusts in correct order with parent first', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test', registerBeans({'bean': STUB_VALUE}));
			builder.adjustContainer('Test.Child', replaceBeans({'bean': ANOTHER_VALUE}));

			await buildAndAssertBeans(builder, 'Test.Child', {
				"bean": ANOTHER_VALUE
			});
		});

		it('adjusts in correct order with child first', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test.Child', registerBeans({'bean': STUB_VALUE}));
			builder.adjustContainer('Test', replaceBeans({'bean': ANOTHER_VALUE}));

			await buildAndAssertBeans(builder, 'Test.Child', {
				"bean": ANOTHER_VALUE
			});
		});

		it('adds adjusters to descendants', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test.Child.Grandchild',
					registerBeans({'grandchild': STUB_VALUE}));
			builder.adjustContainer('Test.Child', registerBeans({'child': ANOTHER_VALUE}));
			builder.adjustContainer('Test', registerBeans({'parent': THIRD_VALUE}));

			await buildAndAssertBeans(builder, 'Test.Child.Grandchild', {
				"grandchild": STUB_VALUE,
				"child": ANOTHER_VALUE,
				"parent": THIRD_VALUE,
			});
		});

		it('adds adjusters to descendants when a generation is missing', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test.Child.Grandchild',
					registerBeans({'grandchild': STUB_VALUE}));
			builder.adjustContainer('Test', registerBeans({'parent': ANOTHER_VALUE}));

			await buildAndAssertBeans(builder, 'Test.Child.Grandchild', {
				"grandchild": STUB_VALUE,
				"parent": ANOTHER_VALUE,
			});
		});

		it('does not add adjusters to ancestors', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test', registerBeans({'parent': STUB_VALUE}));
			builder.adjustContainer('Test.Child', registerBeans({'child': ANOTHER_VALUE}));

			await buildAndAssertBeans(builder, 'Test', {
				"parent": STUB_VALUE,
				"child": null
			});
		});

		it('calls each adjuster only once', async function () {
			const builder = new WiringBuilder();

			/*
			 * This will fail if it is called twice because the bean will already exist.
			 */
			const adjuster = registerBeans({'bean': STUB_VALUE});
			/*
			 * Adjust both parent and child, twice each.
			 */
			builder.adjustContainer('Test', adjuster);
			builder.adjustContainer('Test', adjuster);
			builder.adjustContainer('Test.Child', adjuster);
			builder.adjustContainer('Test.Child', adjuster);

			await buildAndAssertBeans(builder, 'Test.Child', {
				"bean": STUB_VALUE
			});
		});

	});

	describe('for wiring adjusters', function () {

		it('throws with invalid base adjuster provided', async function () {
			const builder = new WiringBuilder();

			expect(() => builder.adjustBaseWiring("badly")).to.throw(TypeError);
		});

		it('throws with invalid wiring provided to callback', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustBaseWiring(async (addWiring) => addWiring("badly"));

			expect(() => builder.adjustContainer('Test', 'Child', () => {})).to.throw(TypeError);
		});

		it('applies base adjuster before creating container', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('applies two base adjusters in correct order', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));
			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
					replaceBeans({'bean': ANOTHER_VALUE})));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': ANOTHER_VALUE
			});
		});

		it('applies in correct order with base adjuster then container adjuster', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));
			builder.adjustContainer('Test', replaceBeans({'bean': ANOTHER_VALUE}));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': ANOTHER_VALUE
			});
		});

		it('applies in correct order with container adjuster then base adjuster', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Test', registerBeans({'bean': STUB_VALUE}));
			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
					replaceBeans({'bean': ANOTHER_VALUE})));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': ANOTHER_VALUE
			});
		});

		it('applies in correct order with two base adjusters then container adjuster', async function () {
			/*
			 * This guards against an old race condition due to forgotten `await`s.
			 */

			const builder = builderWithContainerType('Test');

			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));
			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
					replaceBeans({'bean': ANOTHER_VALUE})));
			builder.adjustContainer('Test', replaceBeans({'bean': THIRD_VALUE}));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': THIRD_VALUE
			});
		});

		it('applies nested adjusters', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustBaseWiring((addWiring) => {
				const wiringToAdd = builderWithContainerType('Test')
				.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
						registerBeans({'bean': STUB_VALUE})))
				.build();

				addWiring(wiringToAdd);
			});

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('applies adjuster only once', async function () {
			const builder = builderWithContainerType('Test');

			/*
			 * Don't use wiringAdjusterToAdjustContainer here, because we don't want to test
			 * whether the passed in container adjuster is prevented from running twice; we
			 * want distinct container adjusters to be created and cause a failure if the
			 * wiring adjuster is applied twice.
			 */
			const adjuster = async (addWiring) => {
				const wiringToAdd = new WiringBuilder()
				.adjustContainer('Test', registerBeans({ 'bean': STUB_VALUE }))
				.build();
				addWiring(wiringToAdd);
			};
			builder.adjustBaseWiring(adjuster);
			builder.adjustBaseWiring(adjuster);

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('applies container adjuster only once from local then supplied wiring', async function () {
			const builder = new WiringBuilder();

			const adjuster = registerBeans({'bean': STUB_VALUE});
			builder.adjustContainer('Test', adjuster);
			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test', adjuster));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('applies container adjuster only once from supplied then local wiring', async function () {
			const builder = builderWithContainerType('Test');

			const adjuster = registerBeans({'bean': STUB_VALUE});
			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test', adjuster));
			builder.adjustContainer('Test', adjuster);

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('creates container types supplied by adjuster', async function () {
			const builder = new WiringBuilder();

			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('applies adjuster to existing descendants', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Parent.Child', () => {});
			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Parent',
					registerBeans({'bean': STUB_VALUE})));

			await buildAndAssertBeans(builder, 'Parent.Child', {
				'bean': STUB_VALUE
			});
		});

		it('applies adjuster to descendants added later', async function () {
			const builder = new WiringBuilder();

			builder.adjustBaseWiring(wiringAdjusterToAdjustContainer('Parent',
					registerBeans({'bean': STUB_VALUE})));
			builder.adjustContainer('Parent.Child', () => {});

			await buildAndAssertBeans(builder, 'Parent.Child', {
				'bean': STUB_VALUE
			});
		});

		it('throws without container type for after-adjustment', async function () {
			const builder = new WiringBuilder();

			expect(() => builder.adjustWiringAfter(() => {})).to.throw(TypeError);
		});

		it('throws with invalid after-adjuster provided', async function () {
			const builder = new WiringBuilder();

			expect(() => builder.adjustWiringAfter('Test', 'Child', () => {})).to.throw(TypeError);
		});

		it('creates container type by after-adjustment', async function () {
			const builder = new WiringBuilder();

			builder.adjustWiringAfter('Test', () => {});

			/*
			 * Really just checking there's no "unknown container type" error.
			 */
			await buildAndAssertBeans(builder, 'Test', {});
		});

		it('applies adjuster after creating container', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustContainer('Primer', registerContainer('testContainer', 'Test'));
			builder.adjustWiringAfter('Primer', wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));

			await buildAndAssertSubsequentBeans(builder, 'Primer', 'testContainer', {
				'bean': STUB_VALUE
			});
		});

		it('does not apply adjuster until after creating container', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustWiringAfter('Primer', wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': null
			});
		});

		it('applies previously-uncalled adjuster to subsequent container', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustContainer('Primer', registerContainer('anotherPrimer', 'Primer'));
			builder.adjustWiringAfter('Primer', wiringAdjusterToAdjustContainer('Primer',
					registerBeans({'bean': STUB_VALUE})));

			const wiring = builder.build();
			const primer = await wiring.createContainer('Primer');
			await assertBeans(primer, {
				'bean': null
			});
			const container = await primer.get('anotherPrimer');
			await assertBeans(container, {
				'bean': STUB_VALUE
			});
		});

		it('applies adjuster after existing descendants', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustContainer('Primer.Child', registerContainer('testContainer', 'Test'));
			builder.adjustWiringAfter('Primer', wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));

			await buildAndAssertSubsequentBeans(builder, 'Primer.Child', 'testContainer', {
				'bean': STUB_VALUE
			});
		});

		it('applies adjuster after descendants added later', async function () {
			const builder = builderWithContainerType('Test');

			builder.adjustWiringAfter('Primer', wiringAdjusterToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));
			builder.adjustContainer('Primer.Child', registerContainer('testContainer', 'Test'));

			await buildAndAssertSubsequentBeans(builder, 'Primer.Child', 'testContainer', {
				'bean': STUB_VALUE
			});
		});

		it('passes container to after-adjuster', async function () {
			const builder = new WiringBuilder();

			let actualContainer = null;
			builder.adjustWiringAfter('Test', async (addWiring, passedContainer) => {
				actualContainer = passedContainer;
			});

			const wiring = builder.build();
			const expectedContainer = await wiring.createContainer('Test');
			expect(actualContainer).to.equal(expectedContainer);
		});

	});

	describe('for adding wiring', function () {

		it('throws with invalid wiring provided for import', async function () {
			expect(() => new WiringBuilder('faulty')).to.throw(TypeError);
		});

		it('imports container adjusters from wiring', async function () {
			const wiringToImport = wiringToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE}));

			const builder = new WiringBuilder(wiringToImport);

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('imports wiring adjusters from wiring', async function () {
			const wiringToImport = wiringToAdjustBaseWiring('Test',
					registerBeans({'bean': STUB_VALUE}));

			const builder = new WiringBuilder(wiringToImport);

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('throws attempting to add invalid wiring', async function () {
			const builder = new WiringBuilder();

			expect(() => builder.addWiring('faulty')).to.throw(TypeError);
		});

		it('adds container adjusters from wiring', async function () {
			const wiringToAdd = wiringToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE}));

			const builder = new WiringBuilder().addWiring(wiringToAdd);

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('adds wiring adjusters from wiring', async function () {
			const wiringToAdd = wiringToAdjustBaseWiring('Test',
					registerBeans({'bean': STUB_VALUE}));

			const builder = new WiringBuilder().addWiring(wiringToAdd);

			await buildAndAssertBeans(builder, 'Test', {
				'bean': STUB_VALUE
			});
		});

		it('adds wiring twice in correct order', async function () {
			const builder = new WiringBuilder();

			builder.addWiring(wiringToAdjustContainer('Test',
					registerBeans({'bean': STUB_VALUE})));
			builder.addWiring(wiringToAdjustContainer('Test',
					replaceBeans({'bean': ANOTHER_VALUE})));

			await buildAndAssertBeans(builder, 'Test', {
				'bean': ANOTHER_VALUE
			});
		});

		it('includes ancestor container adjusters when adding container type from wiring', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Parent', registerBeans({'bean': STUB_VALUE}));
			builder.addWiring(wiringToAdjustContainer('Parent.Child',
					replaceBeans({'bean': ANOTHER_VALUE})));

			await buildAndAssertBeans(builder, 'Parent.Child', {
				'bean': ANOTHER_VALUE
			});
		});

		it('applies container adjuster from wiring to descendants', async function () {
			const builder = new WiringBuilder();

			builder.adjustContainer('Parent.Child', registerBeans({'bean': STUB_VALUE}));
			builder.addWiring(wiringToAdjustContainer('Parent',
					replaceBeans({'bean': ANOTHER_VALUE})));

			await buildAndAssertBeans(builder, 'Parent.Child', {
				'bean': ANOTHER_VALUE
			});
		});

	});

	describe('mutability and subclassing', function () {

		it('builder mutations do not affect built wiring', async function () {
			const builder = builderWithContainerType('Test');
			const wiring = builder.build();

			builder.adjustContainer('Test', registerBeans({'bean': STUB_VALUE}));

			const container = await wiring.createContainer('Test');
			await assertBeans(container, {
				'bean': null
			});
		});

		it('builder mutations do not affect imported wiring', async function () {
			const wiring = builderWithContainerType('Test').build();
			const builder = new WiringBuilder(wiring);

			builder.adjustContainer('Test', registerBeans({'bean': STUB_VALUE}));

			const container = await wiring.createContainer('Test');
			await assertBeans(container, {
				'bean': null
			});
		});

		it('built wiring is the same subclass as imported wiring', async function () {
			const builder = new WiringBuilder(new SubclassedWiring());

			const wiring = builder.build();

			expect(wiring).to.be.an.instanceOf(SubclassedWiring);
		});

		it('container creation does not affect independent creation', async function () {
			const builder = new WiringBuilder();
			builder.adjustWiringAfter('Primer', wiringAdjusterToAdjustContainer('Primer',
					registerBeans({'bean': STUB_VALUE})));
			const wiring = builder.build();

			const container = await wiring.createContainer('Primer');
			const anotherContainer = await wiring.createContainer('Primer');

			await assertBeans(container, {
				'bean': null
			});
			await assertBeans(anotherContainer, {
				'bean': null
			});
		});

		it('container creation by factory does not affect independent creation', async function () {
			const builder = new WiringBuilder();
			builder.adjustWiringAfter('Primer', wiringAdjusterToAdjustContainer('Primer',
					registerBeans({'bean': STUB_VALUE})));
			const wiring = builder.build();

			const factory =  await wiring.createContainerFactory('Primer');
			const container = await factory();
			const anotherContainer = await factory();

			await assertBeans(container, {
				'bean': null
			});
			await assertBeans(anotherContainer, {
				'bean': null
			});
		});

		it('created container has wiring bean the same subclass as imported wiring', async function () {
			const builder = new WiringBuilder(new SubclassedWiring());
			builder.adjustContainer('Test', () => {});
			const wiring = builder.build();

			const container = await wiring.createContainer('Test');

			const wiringFromContainer = await container.get('wiring');
			expect(wiringFromContainer).to.be.an.instanceOf(SubclassedWiring);
		});

		it('factory-created container has wiring bean the same subclass as imported wiring', async function () {
			const builder = new WiringBuilder(new SubclassedWiring());
			builder.adjustContainer('Test', () => {});
			const wiring = builder.build();

			const factory = await wiring.createContainerFactory('Test');
			const container = await factory();

			const wiringFromContainer = await container.get('wiring');
			expect(wiringFromContainer).to.be.an.instanceOf(SubclassedWiring);
		});

	});

});

function builderWithContainerType(containerType) {
	const builder = new WiringBuilder();
	builder.adjustContainer(containerType, () => {}); // just to create the container type
	return builder;
}

function registerBeans(beans) {
	return async (container) => {
		const { register, value } = container;
		Object.entries(beans).forEach(([beanName, beanValue]) => {
			register(beanName, value(beanValue));
		});
	};
}

function replaceBeans(beans) {
	return async (container) => {
		const { register, replacement, value } = container;
		Object.entries(beans).forEach(([beanName, beanValue]) => {
			register(replacement(beanName), value(beanValue));
		});
	};
}

function registerContainer(beanName, containerType) {
	return async (container) => {
		const { register, factory, value } = container;
		register(beanName, factory('wiring.createContainer'), value(containerType));
	};
}

function wiringAdjusterToAdjustContainer(containerType, containerAdjuster) {
	return async (addWiring) => {
		addWiring(wiringToAdjustContainer(containerType, containerAdjuster));
	};
}

function wiringToAdjustContainer(containerType, containerAdjuster) {
	return new WiringBuilder()
	.adjustContainer(containerType, containerAdjuster)
	.build();
}

function wiringToAdjustBaseWiring(containerType, containerAdjuster) {
	return new WiringBuilder()
	.adjustBaseWiring(wiringAdjusterToAdjustContainer(containerType, containerAdjuster))
	.build();
}

async function assertBeans(container, beans) {
	for (const [name, value] of Object.entries(beans)) {
		if (value === null) {
			await expect(container.get(name)).to.eventually.be.rejected;
			continue;
		}

		const bean = await container.get(name);
		expect(bean).to.equal(value);
	}
}

async function buildAndAssertBeans(builder, containerType, beans) {
	const wiring = builder.build();
	const container = await wiring.createContainer(containerType);
	await assertBeans(container, beans);
}

async function buildAndAssertSubsequentBeans(builder, containerType, containerBean, beans) {
	const wiring = builder.build();
	const primer = await wiring.createContainer(containerType);
	const container = await primer.get(containerBean);
	await assertBeans(container, beans);
}

class SubclassedWiring extends Wiring {}
