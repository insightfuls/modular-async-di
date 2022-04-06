# modular-async-di

Manage multiple asynchronous IoC/dependency injection containers and reuse bean wiring using modules.

* [Introduction](#introduction)
* [Opinionated usage](#opinionated-usage)
  * [Provided container types](#provided-container-types)
  * [Wiring file](#wiring-file)
    * [Application modules](#application-modules)
  * [Main entry point and startup sequence](#main-entry-point-and-startup-sequence)
  * [Modularising it](#modularising-it)
    * [common-wiring.js](#common-wiring.js)
    * [cli-wiring.js](#cli-wiring.js)
    * [console-wiring.js](#console-wiring.js)
    * [wiring.js](#wiring.js)
  * [Overriding beans for testing](#overriding-beans-for-testing)
  * [Opinionated usage API](#opinionated-usage-api)
    * [StructuredWiringBuilder](#structuredwiringbuilder)
    * [StructuredWiring](#structuredwiring)
* [Generic wiring](#generic-wiring)
  * [Concepts](#concepts)
    * [WiringBuilder and Wiring](#wiringbuilder-and-wiring)
    * [Container types](#container-types)
    * [Adjusters](#adjusters)
    * [Container creation](#container-creation)
    * [Subclassing](#subclassing)
  * [Generic wiring API](#generic-wiring-api)
    * [WiringBuilder](#wiringbuilder)
    * [Wiring](#wiring)
* [Version history](#version-history)

## Introduction

Dependency injection is a valuable technique when developing complex applications, allowing modules to be loosely coupled and easily testable. Using a dedicated dependency injection container allows beans to be defined, and specified as dependencies for other beans. We refer to collections of interrelated beans, possibly spanning multiple containers, as "wiring".

When developing with a microservices architecture, much of this wiring is common across many microservices, e.g. related to configuration, logging, HTTP server and so on. This includes the overall application structure, which may involve multiple dependency injection containers, e.g. one for the application itself and others scoped to individual HTTP requests. In line with the "Don't Repeat Yourself" (DRY) principle, this common wiring should be extracted for reuse. Likewise some wiring _portions_, although not ubiquitous, are frequent, e.g. related to database connections and queues. These should be available for use in a modular fashion.

This module supports those endeavours. Two facilities are provided:

* generic wiring management, which allows container types to be defined (in a hierarchy), beans defined for them, and these entire wiring collections to be composed and extended; and
* a more opinionated application structure built on the generic facility.

It uses [minimalist-async-di](https://www.npmjs.com/package/minimalist-async-di) dependency injection containers.

It will probably be most instructive to present the opinionated structure first, so we will do that using a tutorial-based approach, before presenting the generic facility with a more technical focus. Even if the opinionated structure does not fit your use case or preferences, it serves as an example of how to apply the generic facility, so can guide you to develop your own structure. Conversely, even if you do not wish to consume the generic facility directly, its technicalities may shed light on more subtle aspects of the opinionated structure.

## Opinionated usage

We'll build a commandline "hello, world" application, but we'll overcomplicate it so with a bit of imagination you might be able to see how the techniques would apply to real microservices.

### Provided container types

The opinionated application structure is based on these container types:

* `Boot`: Intended to be created just once, the bootstrap container holds just enough beans to configure the application, which may include reading configuration files, querying a configuration service, parsing commandline arguments, etc..

* `App`: Also intended to be created just once, the application container holds the application itself, in a bean named `app`. Dependency beans may include such things as an HTTP server.

* `Scope.*`: There can be any number types for logically scoped containers, and containers of each type would generally be created many times. The most prevalent of these would surely be `Scope.Request` to represent the scope of an incoming HTTP request. Factories to create scoped containers are placed into other containers (primarily the application container), injected into other beans as dependencies and called when required.

### Wiring file

The application's wiring is generally encapsulated in a single file, e.g. `wiring.js`. Here's a "hello, world" one.

```javascript
const { StructuredWiringBuilder } = require('modular-async-di');
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
```

Some important observations:

* A `StructuredWiringBuilder` is instantiated, and various `adjust...` methods are called to register beans in different containers.

* Every container contains a `wiring` bean provided by the wiring itself (here it's used just in the application container).

* An optional additional `bootOptions` parameter is supported when adjusting the bootstrap container.

* The bootstrap container has an `appContainer` bean and an `app` bean which references the application inside its container (these aren't used above, but we'll rely on them in the next section).

* An additional `bootContainer` parameter is provided when adjusting the application container. Here the configuration is retrieved from it and used to decide what to register in the application container.

* The application container has a `bootContainer` bean provided by the wiring itself. We use it to register a config bean as an alias.

* The `createRequestContainer` bean is registered to be created by calling `wiring.createScopeContainerFactory`, passing the scope type (in this case `Request`) and optionally additional arguments. Here the container is passed as an additional argument, which is good practice allowing containers to be connected together. This additional argument appears as an additional argument when adjusting the request scope container. (The additional `name` argument is provided when calling the factory.)

* There is no separate step to create the `Request` scope container; it is implicitly created by being adjusted.

* It is our responsibility to register the `appContainer` bean in the request scope container.

* A number of times throughout the wiring, aliases are registered in one container to beans in another (preceding) container. This needs to be done with care. For example, typically in request scope, your logger will be decorated to include request-specific metadata (such as a correlation ID). If you alias any beans in the application container which have a logger injected, that logger will be the undecorated logger from the application container. Probably what you want to do is create a new instance of the bean, instead of aliasing it. Or you may need to split the bean to include some shared _data_ kept in the application container, but with _actions_, including logging, performed by a bean instantiated in scope containers (and possibly also in the application container to service other application-wide beans).

* The module builds and exports `StructuredWiring`.

Don't forget that the dependency injection containers are from [minimalist-async-di](https://www.npmjs.com/package/minimalist-async-di), so to fully understand what's going on within the closures, you may need to refer to its documentation.

#### Application modules

Here are the modules for our little example application (`modules.js`):

```javascript
exports.parseCommandLine = function(cliArguments) {
    return {
        useColour: cliArguments.includes("--colour") || cliArguments.includes("--color"),
        names: cliArguments.filter((cliArgument) => !cliArgument.startsWith('-'))
    };
};

exports.App = class App {
    constructor(config, createRequestContainer) {
        this.config = config;
        this.createRequestContainer = createRequestContainer;
    }
    async run() {
        for (const name of this.config.names) {
            const container = await this.createRequestContainer(name);
            const greeter = await container.get('greeter');
            await greeter.greet();
        }
    }
};

exports.Greeter = class Greeter {
    constructor(writeLine, emphasise, name) {
        this.writeLine = writeLine;
        this.emphasise = emphasise;
        this.name = name;
    }
    async greet() {
        this.writeLine("Hello, " + this.emphasise(this.name) + "!");
    }
};
```

The only interesting part is in the `App` where a request scope container is created for each "request" (in this case, for each person named on the commandline), then the `greeter` bean is retrieved from it, and its `greet` method is called to do the real work. Typically this "create scope container, retrieve, call" pattern is used in an HTTP server route which becomes a thin wrapper around the real microservice resources.

### Main entry point and startup sequence

The `main.js` for "hello, world" is very simple:

```javascript
require('./wiring')
.createBootContainer({
    emphasisColour: "magenta"
})
.then((container) => container.get('app'))
.then((app) => app.run())
.catch(console.error);
```

It runs now:

```javascript
$ npm install modular-async-di
$ npm install chalk
$ node main.js John Howard --colour
Hello, John!
Hello, Howard!
```

The startup and operational sequence of the application is as follows:

1. A main entry point loads the application's wiring.

2. The main entry point creates a bootstrap container, passing `bootOptions` (containing `emphasisColour` here). The wiring performs all the necessary adjustments to the container (and as we will see later, also applies modular wiring before and/or after creating the container).

3. The main entry point retrieves the application from the bootstrap container. This triggers the creation of the application container. The wiring performs all the necessary adjustments to the container.

4. The main entry point starts/runs the application.

5. As the application operates, it handles requests (here it just iterates commandline arguments, but alternatively there may be an HTTP server handling requests, consumption of items from a queue, and/or other activities, which may share or use different scope types). When each request arrives, the application creates a scope container, passing appropriate request-specific information to the factory, retrieves a bean from it, and calls the bean to truly handle the request.

Some comments:

* A real application definitely shouldn't be passing what is really configuration through `bootOptions`. A more appropriate use of `bootOptions` is to pass an object that conforms to the interface of your logger but buffers log messages generated during the startup process. When the application is started, with a real logger injected, it can flush these startup log messages through the real logger, or if anything goes wrong during startup, fallback logic in `main.js` can do something useful with the buffered messages.

* In "hello, world" there is just `app.run()`, so the `catch()` above will handle uncaught errors for the entire application's execution. More commonly you will have `app.start()` (and perhaps `app.stop()` that you hook up to signals such as `SIGTERM`, `SIGINT`, `SIGHUP` and events such as uncaught exceptions and unhandled rejections), so a `catch()` in `main.js` will only handle startup errors, and uncaught errors at other points in your application will be handled another way (e.g. by your HTTP server technology).

### Modularising it

Even in this small application we can see opportunities to split this wiring into logical modules. There are concerns which would be common to all microservices and CLI tools we might build, such as configuration. Then there are CLI-specific concerns, such as the arguments. For the purpose of demonstration, we could split out the console-related concerns, too. Let's take these one at a time.

#### common-wiring.js

```javascript
const { StructuredWiringBuilder } = require('modular-async-di');

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
```

There are a few points of interest:

* The structure is essentially the same as the application's `wiring.js`, but within an exported factory function rather than building and exporting the wiring when the module is loaded. More on this later.

* The `config` bean is initialised to an empty object to which properties will be added shortly. This supports modularisation, because different wiring modules can provide different parts of the configuration as needed. This is one of a number of useful strategies to support modularisation:

    * Initialise an empty object, so modules can add properties to it as 'sub-beans'. This is useful for things such as configuration.
    * As above, but use another bean to turn it into an array via `factory(Object.values)`. This allows modules to independently add items to a list where order is not important. It's useful for things such as adding HTTP server routes, or gathering internal services that need to be started when the app is started.
    * As above, but flatten into a single array via something like `factory((object) => [].concat(...Object.values(object)))`. This has similar use cases to the unflattened array, but modules can add multiple items at a time under a single sub-bean.
    * As above, but flatten into a single object via something like `factory((object) => Object.assign({}, ...Object.values(object)))`. Nice if modules may provide more properties at a time than is clean to represent as separate sub-beans. Building up request metadata and suchlike can use this approach.
    * Define ordered lists by defining the individual items as separate beans, and then the list via something like `constructor(Array)`, injecting all the individual items. This allows modules, or an application itself, to override any of the individual items, or reuse the items but override the list, or a combination. Can be useful for such things as HTTP server middleware.

* Although we might not need request scope in _everything_ we build, we need it often enough that it wouldn't hurt to register it here. If it isn't injected into anything, the bean will never be even created, let alone the factory called, so it won't cause any errors.

* By omitting the type of scope to `adjustScopeContainer`, beans are registered in _all_ scopes that might be created.

* Since the all-scopes adjuster relies on `appContainer` being passed, that's a requirement whenever we create a scope container of any kind, which is something we would document. Documenting your wiring is not just valuable for ensuring your modules' requirements are satisfied; it's also useful because it segregates your beans into public (documented) and private (undocumented) ones, which means you are free to change the private ones without breaking anything.

#### cli-wiring.js

```javascript
const { StructuredWiringBuilder } = require('modular-async-di');
const { commonWiring } = require('./common-wiring');

exports.cliWiring = function() {

    const builder = new StructuredWiringBuilder(commonWiring());

    builder.adjustBootContainer(async function cliWiringBootContainer(container) {
        const { register, value } = container;

        register('cliArguments', value(process.argv.slice(2)));
    });

    return builder.build();

};
```

Of interest above is that the common wiring is imported into the `StructuredWiringBuilder`, so the CLI wiring incorporates and extends that wiring. Practically, this means that a CLI tool only needs to import the CLI wiring, not both the common wiring and the CLI wiring.

#### console-wiring.js

```javascript
const { StructuredWiringBuilder, requireVersion } = require('modular-async-di');

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
```

Again, a few things of interest:

* The factory function which creates the wiring has an `options` argument. You can use whatever arguments you like. Above it's used to substitute a different bean. More commonly, it's used to allow multiple distinct instances of a wiring module to be used in the same application. For example, an application which moves data from one database to another might need two sets of database wiring. In that case, options such as which `config` property to find the database config in, and a prefix to use for all bean names provided by the wiring module would be appropriate.

* `require` is deliberately called conditionally, so if colour is not required, `chalk` is not imported, and in fact needn't even be installed. This allows a library of wiring modules to be published that rely on numerous different/specialised NPM modules, and applications consuming the wiring library only need to install the NPM modules related to the wiring modules they are using.

* A tiny `requireVersion` utility is used to ensure a compatible version of the module is installed (e.g. forcing wiring consumers to upgrade). It requires `semver` to be installed. Instead of using `requireVersion`, you could use `semver.satisfies` to identify different versions and define compatible beans accordingly, thus hiding version differences from your application. Using either of these methods, it's common even for _incompatible_ version upgrades of dependencies to only require a _compatible_ version increment of the wiring library.

All the wiring modules above would be published to one or more NPM modules, either a single wiring library, or multiple (which could remove some of the complexity above, but has its own challenges). Often a hybrid approach is best, grouping highly dependent wiring modules together.

#### wiring.js

Finally, here's what the application's `wiring.js` now looks like to compose the modules:

```javascript
const { StructuredWiringBuilder } = require('modular-async-di');
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
```

To notice here:

* There are two additional `StructuredWiringBuilder` `adjust...` methods used.

* `adjustBaseWiring` adjusters are called before any container is created, and are passed a callback to use to add wiring, but no other arguments (used here to add CLI wiring).

* `adjustWiringAfterBoot` adjusters are called after the bootstrap container is created, and are passed a callback to use to add wiring, as well as the bootstrap container so wiring modules can be added according to configuration (used here to add console wiring, with appropriate colour options).

* Another potential use for `adjustWiringAfterBoot`, most likely in a wiring module, would be to start a real logger registered in the bootstrap container but not injected into anything, and flush the buffering logger through it (see comment [above](#main-entry-point-and-startup-sequence)). That would allow an alias to the real logger to then be placed in the application container and injected throughout the application.

* You can see the empty `config` object from the common wiring being populated in the bootstrap container.

The application can be run and behaves exactly the same as the [unmodularised version did](#main-entry-point-and-startup-sequence). You just need to additionally `npm install semver`.

### Overriding beans for testing

Another use case for wiring modularisation is testing. You can import the application's wiring, further adjust it to replace beans with test doubles, and then execute your tests. For example:

```javascript
const expect = require('chai').expect;
const { StructuredWiringBuilder } = require('..');
const builder = new StructuredWiringBuilder(require('./wiring'));

let inputArgs;
let outputMessages;

builder.adjustBootContainer(async function (container) {
    const { register, replacement, factory } = container;

    register(replacement('cliArguments'), factory(() => inputArgs));
});

builder.adjustAppContainer(async function (container) {
    const { register, replacement, value } = container;

    register(replacement('console'), value({
        log(message) { outputMessages.push(message); }
    }));
});

const wiring = builder.build();

describe("hello, world!", function () {

    beforeEach(function () {
        inputArgs = [];
        outputMessages = [];
    });

    it("works correctly without colour", async function () {
        inputArgs = ["John", "Howard"];

        const container = await wiring.createBootContainer({})
        const app = await container.get('app');
        await app.run();

        expect(outputMessages).to.deep.equal([
            "Hello, John!",
            "Hello, Howard!"
        ]);
    });

});
```

The input CLI arguments are replaced with test data, and the output messages are captured using a fake console and asserted.

### Opinionated usage API

Very brief summary. See the tutorial examples above to understand how these work, and the generic wiring documentation below to understand technicalities.

#### StructuredWiringBuilder

* `new StructuredWiringBuilder([wiring])`
* `builder.adjustBaseWiring(async (addWiring) => { ... })`
* `builder.adjustBootContainer(async (bootContainer, [bootOptions]) => { ... })`
* `builder.adjustWiringAfterBoot(async (addWiring, bootContainer) => { ... })`
* `builder.adjustAppContainer(async (appContainer, bootContainer) => { ... })`
* `builder.adjustScopeContainer([scopeType,] async (scopeContainer, ...) => { ... })`
* `builder.addWiring(wiring)`
* `builder.build()`
* plus other methods inherited from `WiringBuilder` but which probably should be avoided

#### StructuredWiring

These public methods are for use with the instance returned from `StructuredWiringBuilder#build`:

* `async wiring.createBootContainer([bootOptions])`
* `async wiring.createAppContainer([bootOptions])` (a shortcut to create a boot container and retrieve the app container from it)

These public methods are for use within containers to register beans which are themselves containers, or container factories. Note that the wiring objects within containers should not be leaked; they should _only_ be used as factories to register other beans.

* `async wiring.createScopeContainer(scopeType, ...)`
* `async wiring.createScopeContainerFactory(scopeType, ...factoryArgs)`
  * effectively returns `async (...callerArgs) => wiring.createScopeContainer(scopeType, ...factoryArgs, ...callerArgs)`

`StructuredWiring` also has other methods inherited from `Wiring` but they probably should be avoided.

## Generic wiring

### Concepts

#### WiringBuilder and Wiring

Two classes collaborate to provide wiring management: `WiringBuilder` and `Wiring`.

`WiringBuilder`s can be used to build up/adjust wiring, but cannot be used to create any containers. `WiringBuilder#build()` returns a `Wiring` instance.

`Wiring` objects are conceptually immutable (though during building, and during creation as [explained below](#container-creation), they are mutated 'under the hood'). `Wiring` objects can be used to create containers.

Conversely to building, a `Wiring` object can be imported into a new `WiringBuilder` by passing it to the constructor, and `WiringBuilder#addWiring` can also be used to add wiring objects to the builder. In both cases, the adjusters in the wiring object are incorporated into the builder, not the wiring object itself. More on adjusters [soon](#adjusters).

Because `Wiring` objects are conceptually immutable, if you import one into a `WiringBuilder` you can make adjustments and they will not affect the original object. Also, after you `build()` some wiring, you can make more adjustments to the same `WiringBuilder` without affecting the built wiring, before you call `build()` again.

#### Container types

Any number of container types can be created. Creation is implicit; when you register an adjuster for a particular container type, or to be called after creation of a particular container type, if that type does not exist, it is created.

Container types form a rootless hierarchy by using dot as a delimiter. Adjustments made to a container apply to all descendants (children, grandchildren, etc.). So, for example, adjusting container type `Scope` will also adjust `Scope.Request`, `Scope.Item`, etc..

#### Adjusters

Container adjusters are registered using `WiringBuilder#adjustContainer`, and apply to a particular container type (and descendants). They are synchronous or asynchronous functions that are passed the container being adjusted, along with any additional arguments provided when creating the container. They are primarily intended to be used to register beans in the container (including potentially replacing beans the container already holds).

Wiring adjusters are more complicated. They can be called before any container is created at all (via `WiringBuilder#adjustBaseWiring`) or after the creation of a particular container type (or descendant) (via `WiringBuilder#adjustWiringAfter`). They are synchronous or asynchronous functions that are passed an `addWiring` callback, and in the case of after-adjustment, the container that has just been created. The `addWiring` callback can be called any number of times with `Wiring` objects. Those wiring objects are incorporated into the wiring being adjusted, which can potentially create additional container types, adjust any number of container types, any number of times, and even register additional wiring adjusters (which indeed may be called before creation of the current container completes). This happens at the time the adjuster is _called_ (during container creation), effectively mutating the conceptually-immutable wiring (more on this [later](#container-creation)).

Any given adjuster is only ever applied once. For container adjusters this means once during the creation of any particular container. For wiring adjusters this means both not calling the adjuster more than once for the same `Wiring` instance (subject to the 'branching' that occurs to give the illusion of immutability which will be [discussed shortly](#container-creation)), and to the container adjusters in any wiring added, just as for other container adjusters. This can be helpful in some advanced scenarios where the same adjuster may be registered more than once, as it is included by multiple wiring modules, but it must be done with care. It will not work if you just create new closures with the same source code, for example this will produce a "bean already registered" error:

```javascript
function applyAdjustment(builder) {
	builder.adjustContainer("SomeType", async (container) => {
		const { register, value } = container;
		register("bean", value("value"));
	});
}

const builder = new WiringBuilder();
applyAdjustment(builder);
applyAdjustment(builder);
builder.build().createContainer("SomeType"); // rejects
```

This will work, however, because the same function (`Function` instance), stored in a variable, is passed for both adjustments:

```javascript
function adjuster = async (container) => {
	const { register, value } = container;
	register("bean", value("value"));
};

const builder = new WiringBuilder();
builder.adjustContainer("SomeType", adjuster);
builder.adjustContainer("SomeType", adjuster);
builder.build().createContainer("SomeType"); // fulfills
```

#### Container creation

Containers may be created directly via `Wiring#createContainer`, by passing the container type and optionally additional arguments. Alternatively, they may be created indirectly by creating a factory with `Wiring#createContainerFactory`, passing the container type and optionally additional arguments, and then calling the factory, which also accepts additional arguments. All the additional arguments are consumed by container adjusters (see [above](#adjusters)). All these calls are asynchronous; you have to `await` everything: direct container creation, factory creation, and factory invocation.

Internally, the procedure for creating containers is as follows:

* Clone the current `Wiring` instance and proceed with the creation using the clone, as some mutation may take place.

* Call any base wiring adjusters that have not yet been called for this `Wiring` instance, recursively (i.e. if one wiring adjuster adds more base wiring adjusters, call those too). Record all the container adjusters to be used now and for future container creations.

* Create an empty container.

* Add a `wiring` bean to the empty container which is this `Wiring` instance (the clone). (This bean should not be leaked outside the container, but should only be used as a factory to register other beans which are containers, via `Wiring#createContainer`, or container factories, via `Wiring#createContainerFactory`.)

* Call all the container adjusters relevant to the given container type (those for the type itself, or any ancestor type), though only calling any given one once. The order in which these are called is dictated by the order in which `new WiringBuilder`, `WiringBuilder#adjust...` and `WiringBuilder#addWiring` were called. It may be tempting to think that there might be some kind of hierarchical ordering, or ordering based on this container creation procedure, e.g. container adjusters provided by base wiring adjusters prior to those provided directly to wiring and/or adjusters for parent container types before those for their children, but all this is incorrect. One way to think of it is as follows: Imagine you inlined all the adjusters and modular wiring so you just had linear code on the screen that ran from top to bottom, with the content of everything visible. Remove wiring after-adjusters whose containers have not been created yet (regardless of how deeply nested). And remove all but the first copy of any adjuster which appears more than once (regardless of how deeply nested, though remember, they must have actually originated from the same object prior to your imagined inlining, not just have the same content). The order the remaining container adjusters are called, and the bean registrations within them are made, is the order they appear on screen, top to bottom.

* Call any wiring adjusters intended to be called after the creation of the given container type (or any ancestor type), just the same as the base wiring adjusters. There are some edge cases relating to this step which will be discussed in a moment.

* Return the adjusted container.

The illusion of immutability is maintained by the cloning step above. The conceptual immutability has some implications which may be surprising:

* Wiring adjusters used for after-adjustment do not have any effect on the wiring instance you used to create the preceding container. If you call `w.createContainer('A')`, and an after-adjuster for `A` makes adjustments to `B`, calling `w.createContainer('B')` will not give you a container which reflects those adjustments. We can call the two containers created this way _independent_. To get a container which _does_ reflect the adjustments, you have to create a bean in `A` that is itself, or is a factory for, `B` containers, i.e. (omitting `await`) `w.createContainer('A').get('containerB')` or `w.createContainer('A').get('createB')()`. We call such containers _ensuing_ containers. You can imagine it as a tree, with each _independent_ container adding an adjacent branch, and each _ensuing_ container extending a branch. As the branches get longer and thinner, there are less after-adjusters remaining to be called.

* When you use a container factory, it starts from the same `Wiring` instance each time, so it creates _independent_ containers and after-adjusters will be called every time the factory is called, not just the first. I.e. if you have `factory = await w.createContainerFactory('A')` and an after-adjuster for `A`, then every time you call the factory, the after-adjuster will be called. If you create an _ensuing_ container, however, via a bean in the first container, the same after-adjuster will _not_ be called again.

Wiring adjusters used for after-adjustment also give rise to some edge cases, since they result in adjusters from arbitrary additional wiring objects being incorporated into the current wiring.

* This could include container adjusters for container types which have already been created, meaning if an _ensuing_ container is created, it will be adjusted differently to the previous one, even for the same creation arguments.

* It could also include base wiring adjusters. However, base wiring adjusters were already called _before_ container creation. The new base adjusters will be run if an _ensuing_ container is created. They may or may not result in any impact or inconsistency, depending which container types the base wiring has container adjusters for, and which containers have been and will be created.

These edge cases arise because they violate the intuitive rules that:
 
* after-adjusters should only be used to adjust containers that haven't been created yet along the branch of _ensuing_ containers;

* the same container type should not appear more than once along the same branch of _ensuing_ containers.

There's no real reason these rules _must_ be adhered to, but it can be surprising when they are not.

#### Subclassing

You can subclass `WiringBuilder` and `Wiring` to create your own more opinionated structure if you wish. There are two important requirements:

* Your builder constructor should always pass an instance of your wiring class to the `WiringBuilder` superclass constructor. This means if no wiring object is provided to import you should construct an empty one. You should not call the `WiringBuilder` superclass constructor without arguments.

* Your wiring constructor must accept another instance of itself to create a clone.

These requirements are because when wiring clones itself, it is done by calling `new this.constructor(this)` (and equivalent when the `WiringBuilder` clones some wiring). Following the rules above ensures that the `WiringBuilder` always has internal wiring of the right subclass, which means `build()` will return the right subclass, and as containers are created, the cloned wiring will maintain the right subclass.

`StructuredWiringBuilding` and `StructuredWiring` serve as examples of this.

### Generic wiring API

#### WiringBuilder

`new WiringBuilder(wiring)`
* Constructs a new wiring builder.
* `wiring` is optional; it can be used to import an existing `Wiring` object to adjust.

`builder.adjustBaseWiring(wiringAdjuster)`
* Registers an adjuster to be called prior to creating any container which can add (modular) wiring.
* `wiringAdjuster` is a callback: `async (addWiring)`. It should simply call the provided `addWiring` callback as many times as desired, each time passing a `Wiring` object to compose into the wiring being adjusted.
* Returns `this`.

`builder.adjustContainer(containerType, containerAdjuster)`
* Registers an adjuster to be called when a container of a particular type is created which can register beans.
* `containerType` is a string container type, which may include dots to define a hierarchy where all adjustments made to a parent container type are also made to all its descendent container types.
* `containerAdjuster` is a callback: `async (container, ...)`. It is passed a `minimalist-async-di` container, followed by any arguments from `Wiring#createContainer`. It may register (including replacing) beans in the container as desired.
* Returns `this`.

`builder.adjustWiringAfter(containerType, wiringAdjuster)`
* Registers an adjuster to be called after a container of a particular type is created which can add (modular) wiring.
* `containerType` is a string container type, which may include dots to define a hierarchy where all adjustments made to a parent container type are also made to all its descendent container types.
* `wiringAdjuster` is a callback: `async (addWiring, container)`. It should simply call the provided `addWiring` callback as many times as desired, each time passing a `Wiring` object to compose into the wiring being adjusted.
* Returns `this`.

`builder.addWiring(wiring)`
* Add (modular) wiring.
* `wiring`: wiring to compose into the wiring being adjusted.
* Returns `this`.

`builder.build()`
* Return the built `Wiring` object.

#### Wiring

`wiring.createContainer(containerType, ...)`
* Creates a container of the given type asynchronously (returns a promise for the container).
* Any additional arguments are passed on to container adjusters.

`wiring.createContainerFactory(containerType, ...)`
* Returns asynchronously (a promise for) an asynchronous container factory for the given type. This means you need to `await` both the call to `createContainerFactory` as well as calls to the returned factory.
* Any additional arguments to `createContainerFactory` followed by any arguments to the returned factory are passed on to container adjusters when the factory is called.

## Version history

Major changes:

* `v1`: Initial version.

For details on minor/patch changes, consult the commit history.

