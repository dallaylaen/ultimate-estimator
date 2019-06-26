/*
 *  jrna.js - interactive stateful UI widgets
 */
"use strict";

/*
First of all, some macros for jsdoc because it's too boring to write it every time

@macro oneof
    one of {@link jRna#attach attach}, {@link jRna#appendTo appendTo},
    or {@link jRna#instantiate instantiate}
@end oneof

@macro mutator name
    @function %(name)
    @memberOf jRna
    @instance
    @returns {jRna} <tt>this</tt> (chainable)
@end mutator

@macro id
    @param {string} receptor
    A jrna-prefixed class in the DOM
@end id

@macro receptor
    @param {string|Array} receptor
    A jrna-prefixed class in the DOM
    and the name of the corresponding property in the jRna instance.
    Use a 2-element array if different names are needed.
@end receptor

@macro currycb name args when
    @param {function|string|Array} %(name)
    Run <tt>%(name)(%(args))</tt> %(when).
    <tt>this</tt> is set to current <i>jRna instance</i>.
    A method name may be used instead of function.
    An Array may be used containing any of the above
    plus some additional values to be prepended to the argument list.
@end currycb

*/

/* global window:false */
// first check for $
if (typeof window !== 'undefined' &&
    (typeof window.$ !== 'function' || typeof window.document === 'undefined'))
        throw new Error('jRna: refusing to run without a window.$ and window.document');

/*  // skip apidoc for once
 *  Get the file and line several stack frames above the caller
 *  (similar to Perl's Carp::shortmess)
 *  This is only used internally to point out
 *  which exactly jRna object is causing the trouble.
 *
 *  @param {Number} depth - Number of stack levels to skip
 *  @return {String} file:line:column
 */
function get_stack(n) {
    /* a terrible rex that basically searches for file.js:nnn:nnn several times*/
    const in_stack = /(?:at\s+|@|\()\s*((?:\w+:\/\/)??[^:\s]+:\d+(?::\d+)?)\W*(\n|$)/g;
    const stack = new Error().stack;
    /* skip n frames */
    for (;n-->0;)
        if (!in_stack.exec(stack))
            return null;
    return (in_stack.exec(stack) || [])[1];
}

/**
*   jRna is an application building block that maps its internal state
*   onto a DOM subtree.
*
*   To actually become effectful, it must be instanciated with
*   @oneof
*       one of {@link jRna#attach attach}, {@link jRna#appendTo appendTo},
*       or {@link jRna#instantiate instantiate}
*   @end oneof
*   methods.
*
*   @constructor
*   @this {jRna}
*/
function jRna () {
    // `origin` is the place where `new jRna()` was called for given instance.
    // `blame` throws error but also points out where the definition was.
    // This idea was mostly stolen from Perl's Carp module.
    const origin = this.origin = get_stack(2);
    const blame  = function(error) {
        throw new Error( error + " - jRna@"+origin );
    };

    // Use browser to parse HTML.
    const parseHTML = function(str) {
        const fakeHTML = window.document.createElement('div');
        fakeHTML.setAttribute( 'style', 'display: none' );
        fakeHTML.innerHTML = str;
        if (!fakeHTML.firstChild)
            blame("Attempt to use empty HTML");
        if (fakeHTML.firstChild.nodeType !== 1) {
            blame("Attempt to use non-element as HTML container");
        }
        if (fakeHTML.firstChild !== fakeHTML.lastChild) {
            blame("Attempt to create multiple tag HTML");
        }
        return fakeHTML.firstChild;
    };

    // lockName('foo') - prevent using the name again
    // This is internal function
    this._known = {};
    for (let i of [ 'appendTo', 'container', 'element', 'id', 'onAttach', 'onRemove', 'remove' ])
        this._known[i] = true;
    this.lockName = function (name, shared) {
        if (this._known[name] && this._known[name] !== shared) {
            blame( "Property name already in use: "+name );
        }
        this._known[name] = shared || true;
    };
    const isMethod = {};

    /**
    *  Set in-memory HTML snippet to attach to.
    *
    *  @mutator html
    *      @function html
    *      @memberOf jRna
    *      @instance
    *      @returns {jRna} <tt>this</tt> (chainable)
    *  @end mutator
    *  @param {string} html - must contain exactly one root node
    */
    this.html = function( html ) {
        if (html !== undefined) {
            const element = parseHTML( html );
            this._master = element;
        } else {
            this._master = undefined;
        }
        return this;
    };

    /**
    *  Fetch HTML snippet from the document itself.
    *  Typically such snippets should reside within a hidden block.
    *
    *  @mutator htmlFrom
    *      @function htmlFrom
    *      @memberOf jRna
    *      @instance
    *      @returns {jRna} <tt>this</tt> (chainable)
    *  @end mutator
    *  @param {string|jQuery} selector - where to search for the root element
    */
    this.htmlFrom = function(selector) {
        selector = this.checkElement(selector, "get HTML from");
        this.html( selector[0].outerHTML );
        return this;
    };

    const noArgs = {}
    for (let i in this._known)
        noArgs[i] = true;
    const allowArgs = { id : true };
    const assignArgs = { id : true };

    /**
    *  Add one allowed argument with fine-grained control for
    *  @oneof
    *      one of {@link jRna#attach attach}, {@link jRna#appendTo appendTo},
    *      or {@link jRna#instantiate instantiate}
    *  @end oneof
    *
    *  @mutator addArgument
    *      @function addArgument
    *      @memberOf jRna
    *      @instance
    *      @returns {jRna} <tt>this</tt> (chainable)
    *  @end mutator
    *  @param {string} name Name of the argument
    *  @param {Object} spec
    *  { assign: true | false } - whether to try assigning this argument
    *  to eponymous property
    */
    this.addArgument = function( name, spec={} ) {
        if (spec.forbidden) {
            // special case
            if (allowArgs[name])
                blame( 'Forbidden argument name: '+name );
            noArgs[name] = true;
            return this;
        }

        if (noArgs[name])
            blame( 'Forbidden argument name: '+name );
        allowArgs [name] = true;
        assignArgs[name] = spec.assign;
        // TODO more fancy stuff
        return this;
    };

    /**
    *  Specify one or more optional argument keys for
    *  @oneof
    *      one of {@link jRna#attach attach}, {@link jRna#appendTo appendTo},
    *      or {@link jRna#instantiate instantiate}
    *  @end oneof
    *  methods.
    *  May be called more than once.
    *  By default, only 'id' argument is allowed.
    *
    *  @mutator args
    *      @function args
    *      @memberOf jRna
    *      @instance
    *      @returns {jRna} <tt>this</tt> (chainable)
    *  @end mutator
    *  @param {...string} argumentName - list of allowed arguments
    */
    this.args = function(...list) {
        // TODO think about required args & type checks
        for( let i of list )
            this.addArgument( i, { assign: true } );
        return this;
    };

    /**
    *  Upon <i>binding</i>, locate element with receptor class
    *  and execute callback on it and the newly created instance.
    *
    *  Please seriously consider sending a bug report if you ever need
    *  to call this directly.
    *
    *  @mutator setup
    *      @function setup
    *      @memberOf jRna
    *      @instance
    *      @returns {jRna} <tt>this</tt> (chainable)
    *  @end mutator
    *  @id
    *      @param {string} receptor
    *      A jrna-prefixed class in the DOM
    *  @end id
    *  @param {function} action
    *  Call action( instance, element ) while the bound jRna instance
    *  is being created. Note <tt>this</tt> is <i>not</i> set.
    */
    this._setup = [];
    this._wanted = {};
    this.setup = function( id, action ) {
        this._setup.push( [id, action ] );
        this._wanted[ jRna.prefix + id ] = id;
        return this;
    };

    // unify callbacks:
    // function => itself
    // string   => instance method
    // [ function|string, ...args ] => fucntion( args, ... ) // curry!
    // otherwise throw
    const curry = function(item, spec) {
        if (!Array.isArray(spec))
            spec = [ spec ];
        const [todo, ...preargs] = spec;

        // named method - TODO write more efficient code
        if (typeof todo === 'string') {
            return function(...args) {
                return item[todo].apply( item, preargs.concat(args) );
            };
        }

        // normal function with preargs
        if (preargs.length && typeof todo === 'function') {
            return function(...args) {
                return todo.apply( item, preargs.concat(args) );
            };
        }

        // normal function
        // TODO detect already bound functions & throw
        if (typeof todo === 'function')
            return todo.bind(item);

        // finally - don't know what user wants
        blame( 'Unexpected callback argument' );
    };

    /**
    *    Create a writable property. Update will trigger setting the text
    *    content of the affected DOM element.
    *    @mutator output
    *        @function output
    *        @memberOf jRna
    *        @instance
    *        @returns {jRna} <tt>this</tt> (chainable)
    *    @end mutator
    *    @receptor
    *        @param {string|Array} receptor
    *        A jrna-prefixed class in the DOM
    *        and the name of the corresponding property in the jRna instance.
    *        Use a 2-element array if different names are needed.
    *    @end receptor
    */

    this.output = function( receptor ) {
        const [id, name] = jRna.parseId( receptor );
        this.lockName(name);
        return this.setup( id, function ( inst, element ) {
            let value;
            Object.defineProperty(inst, name, {
                get: function() {
                    return value;
                },
                set: function(newval) {
                    element.text(value = newval);
                },
                enumerable: true
            });
        } );
    };

    /**
    *    Create a writable property.
    *    On update, the innerHTML of affected element will be set.
    *    No checks are made whatsoever.
    *    @mutator rawOutput
    *        @function rawOutput
    *        @memberOf jRna
    *        @instance
    *        @returns {jRna} <tt>this</tt> (chainable)
    *    @end mutator
    *    @receptor
    *        @param {string|Array} receptor
    *        A jrna-prefixed class in the DOM
    *        and the name of the corresponding property in the jRna instance.
    *        Use a 2-element array if different names are needed.
    *    @end receptor
    */
    this.rawOutput = function( receptor ) {
        const [id, name] = jRna.parseId( receptor );
        this.lockName(name);
        return this.setup( id, function ( inst, element ) {
            let value;
            Object.defineProperty(inst, name, {
                get: function() {
                    return value;
                },
                set: function(newval) {
                    element.html( value = newval );
                },
                enumerable: true
            });
        } );
    };

    /**
    *    Create a writable property
    *    whose value is equal to affected element's val()
    *    (see val() in jQuery).
    *
    *    @mutator input
    *        @function input
    *        @memberOf jRna
    *        @instance
    *        @returns {jRna} <tt>this</tt> (chainable)
    *    @end mutator
    *    @receptor
    *        @param {string|Array} receptor
    *        A jrna-prefixed class in the DOM
    *        and the name of the corresponding property in the jRna instance.
    *        Use a 2-element array if different names are needed.
    *    @end receptor
    */
    this.input = function( receptor ) {
        const [id, name] = jRna.parseId( receptor );
        this.lockName(name);
        return this.setup( id, function( inst, element ) {
            Object.defineProperty(inst, name, {
                get: function() {
                    return element.val();
                },
                set: function(newval) {
                    element.val(newval);
                },
                enumerable: true
            });
        } );
    };
    /**
    *   Add a click handler.
    *
    *   @mutator click
    *       @function click
    *       @memberOf jRna
    *       @instance
    *       @returns {jRna} <tt>this</tt> (chainable)
    *   @end mutator
    *
    *   @param {string} id - the jrna-prefixed class of the element to work on
    *
    *   @currycb callback clickEvent "when the element is clicked"
    *       @param {function|string|Array} callback
    *       Run <tt>callback(clickEvent)</tt> when the element is clicked.
    *       <tt>this</tt> is set to current <i>jRna instance</i>.
    *       A method name may be used instead of function.
    *       An Array may be used containing any of the above
    *       plus some additional values to be prepended to the argument list.
    *   @end currycb
    */
    this.click = function( id, cb ) {
        return this.setup( id, function( inst, element ) {
            const bound = curry( inst, cb );
            element.on( 'click', function (ev) { bound(ev); return false; } );
        } );
    };
    /**
    *   Alternate between two callbacks when element is clicked.
    *
    *   @mutator toggle
    *       @function toggle
    *       @memberOf jRna
    *       @instance
    *       @returns {jRna} <tt>this</tt> (chainable)
    *   @end mutator
    *   @id
    *       @param {string} receptor
    *       A jrna-prefixed class in the DOM
    *   @end id
    *   @currycb callbackOn clickEvent "on 1st, 3rd, etc clicks"
    *       @param {function|string|Array} callbackOn
    *       Run <tt>callbackOn(clickEvent)</tt> on 1st, 3rd, etc clicks.
    *       <tt>this</tt> is set to current <i>jRna instance</i>.
    *       A method name may be used instead of function.
    *       An Array may be used containing any of the above
    *       plus some additional values to be prepended to the argument list.
    *   @end currycb
    *   @currycb callbackOff clickEvent "on every second click"
    *       @param {function|string|Array} callbackOff
    *       Run <tt>callbackOff(clickEvent)</tt> on every second click.
    *       <tt>this</tt> is set to current <i>jRna instance</i>.
    *       A method name may be used instead of function.
    *       An Array may be used containing any of the above
    *       plus some additional values to be prepended to the argument list.
    *   @end currycb
    */
    this.toggle = function( id, cb_on, cb_off ) {
        return this.setup( id, function( inst, element ) {
            const bound_on = curry( inst, cb_on );
            const bound_off = curry( inst, cb_off );
            let on = false;
            element.on('click', function (ev) {
                if ((on ^= true) == true) {
                    bound_on(ev);
                } else {
                    bound_off(ev);
                }
                return false;
            } );
        } );
    };

    /**
    *  Setup a sticky click handler. Once clicked, it will have no effect
    *  until a "lock" property is reset to a false value.
    *  @mutator stickyClick
    *      @function stickyClick
    *      @memberOf jRna
    *      @instance
    *      @returns {jRna} <tt>this</tt> (chainable)
    *  @end mutator
    *  @id
    *      @param {string} receptor
    *      A jrna-prefixed class in the DOM
    *  @end id
    *  @param {string} name
    *  Boolean property that locks the click
    *  @currycb  callback clickEvent " on click, provided that the lock property is false"
    *      @param {function|string|Array} callback
    *      Run <tt>callback(clickEvent)</tt>  on click, provided that the lock property is false.
    *      <tt>this</tt> is set to current <i>jRna instance</i>.
    *      A method name may be used instead of function.
    *      An Array may be used containing any of the above
    *      plus some additional values to be prepended to the argument list.
    *  @end currycb
    */
    this.stickyClick = function( id, name, cb ) {
        this.lockName( name, 'stickyClick' );
        return this.setup( id, function( inst, element ) {
            const bound = curry( inst, cb );
            element.on('click', function (ev) {
                if (!inst[name]) {
                    inst[name] = true;
                    bound(ev);
                }
                return false;
            } );
        } );
    };
    /**
    *   Create an element shortcut in the jRna instance.
    *   Use <tt>this.element.&lt;className&gt;</tt> instead.
    *   @mutator element
    *       @function element
    *       @memberOf jRna
    *       @instance
    *       @returns {jRna} <tt>this</tt> (chainable)
    *   @end mutator
    *   @receptor
    *       @param {string|Array} receptor
    *       A jrna-prefixed class in the DOM
    *       and the name of the corresponding property in the jRna instance.
    *       Use a 2-element array if different names are needed.
    *   @end receptor
    */
    this.element = function ( receptor ) {
        const [id, name] = jRna.parseId( receptor );
        this.lockName(name);
        this.addArgument(name, { forbidden: 1 });
        return this.setup( id, function( inst, element ) {
            inst[name] = element;
        } );
    };
    /**
    *   @mutator on
    *       @function on
    *       @memberOf jRna
    *       @instance
    *       @returns {jRna} <tt>this</tt> (chainable)
    *   @end mutator
    *   @param {string} trigger
    *   Event to listen to. See jQuery docs for supported event types.
    *   @id
    *       @param {string} receptor
    *       A jrna-prefixed class in the DOM
    *   @end id
    *   @currycb callback event "whenever event is triggered on <tt>receptor</tt> element"
    *       @param {function|string|Array} callback
    *       Run <tt>callback(event)</tt> whenever event is triggered on <tt>receptor</tt> element.
    *       <tt>this</tt> is set to current <i>jRna instance</i>.
    *       A method name may be used instead of function.
    *       An Array may be used containing any of the above
    *       plus some additional values to be prepended to the argument list.
    *   @end currycb
    */
    this.on = function( trigger, id, cb ) {
        return this.setup(id, function(inst, element) {
            const bound = curry( inst, cb );
            element.on(trigger, bound);
        });
    };
    /**
    *   Associate a <tt>&lg;input type="file"&gt;</tt>
    *   with a file upload function that returns a promise.
    *
    *   Please consider using static <tt>jRna.upload</tt> instead.
    *   @mutator upload
    *       @function upload
    *       @memberOf jRna
    *       @instance
    *       @returns {jRna} <tt>this</tt> (chainable)
    *   @end mutator
    *   @receptor
    *       @param {string|Array} receptor
    *       A jrna-prefixed class in the DOM
    *       and the name of the corresponding property in the jRna instance.
    *       Use a 2-element array if different names are needed.
    *   @end receptor
    *   @param {string} [type] Can be 'text' (default), 'raw', or 'url'.
    *
    */
    this.upload = function( receptor, type ) {
        const [id, name] = jRna.parseId( receptor );
        this.lockName(name);
        this.addArgument(name, { forbidden: 1 });
        return this.setup( id, function( inst, element ) {
            // TODO This requires a special element - check whether it can into files
            inst[name] = function(cb) {
                let prom = jRna.uploadFile( element[0].files[0], type );
                if (cb)
                    prom = prom.then(cb.bind(inst));
                return prom;
            };
        } );
    };

    /**
    *  Define a property or fucntion. Any array or object will be shared
    *  across all instances. See also <tt>init</tt>.
    *
    *  @mutator def
    *      @function def
    *      @memberOf jRna
    *      @instance
    *      @returns {jRna} <tt>this</tt> (chainable)
    *  @end mutator
    *  @param {string} name Name of the property
    *  @param {...} initial Set <tt>name</tt> property to this value
    */
    this._init = {};
    this.def = function( name, initial ) {
        this.lockName(name);
        if (typeof initial === 'function')
            isMethod[name] = true;
        this._init[name] = function() { return initial; };
        return this;
    };
    this.init = function( name, action ) {
        this.lockName(name);
        this._init[name] = action;
        return this;
    };
    // TODO initArray & initObject only use shallow copy, so beware
    this.initArray = function( name, start = [] ) {
        return this.init( name, () => [ ...start ] );
    };
    this.initObject = function( name, start = {} ) {
        return this.init( name, () => { return { ...start } } );
    };

    // A stupid state machine that allows to only enter every state once
    this.stickyState = function( name, action_hash, initial ) {
        const runner = jRna.stickySM( action_hash, { origin: name + ' at '+origin, initial } );

        isMethod[name] = true;
        // must use init to avoid sharing state between instances
        return this.init( name, () => runner.run() );
    };

    // callbacks!
    this._onAttach = [];
    this.onAttach = function(fun) {
        this._onAttach.push(fun);
        return this;
    };

    const callbacks  = {
        onRemove   : [],
    };
    for(let i in callbacks) {
        this[i] = function(cb) {
            callbacks[i].push(cb);
            return this;
        };
    }

    this.checkElement = function(element, action="address") {
        // TODO extract the selector from $, too
        if (element === undefined)
            blame( "Cannot "+action+" a null element");

        let selector = '';
        if (typeof element === 'string') {
            selector = ' $('+element+')';
            element = window.$( element );
        }
        if (!(element instanceof window.$))
            blame( "Cannot "+action+" a non-$ object" );
        if (!element.length)
            blame( "Cannot "+action+" a missing element"+selector );
        if ( element.length > 1)
            blame( "Cannot "+action+" an ambiguous element"+selector );
        return element.first();
    };

    function walkTree( root, cb ) {
        cb(root);
        for( let ptr = root.firstChild; ptr !== null; ptr = ptr.nextSibling)
            if (ptr.nodeType === 1) // only Element's are invited
                walkTree(ptr, cb);
    }

    function findClasses( root, wanted ) {
        const found = {};

        walkTree( root, elem => {
            for ( let cls of elem.classList ) {
                if( wanted[cls] === undefined ) continue;
                if( found[cls] )
                    throw new Error('Duplicate element with class '+cls);
                found[cls] = elem;
            }
        });

        for( let cls in wanted )
            if (!found[cls])
                blame('Failed to locate class '+cls);

        return found;
    }

    /**
    *
    *  @function attach
    *  @memberOf jRna
    *  @instance
    *  @returns {jRna.Bound} A new jRna instance bound to a DOM subtree
    *  @param {jQuery} container - the root of DOM subtree to attach to.
    *  It MUST contain exactly one element.
    *  It MUST contain exactly one instance of each {@link jRna.receptor}
    *  @param {Object} [args] - optional argument values specified
    *  via {@link jRna#args}
    */
    this.attach = function(container, args={}) {
        // validate container first, check args after instance is populated
        container = this.checkElement(container, "attach to");

        // rename this to meta to avoid confusion with instance's `this`
        const meta = this;

        const inst = new jRna.Bound();
        inst.container   = container;

        for (let i in callbacks) {
            // inst._foobar actual callback list, inst.foobar appender
            inst['_'+i] = [].concat(callbacks[i]);
            inst[i] = function(cb) {
                inst['_'+i].push(cb);
                return inst;
            };
        }

        // All jrna-classed "receptor" elements
        inst.element    = {};

        // TODO better name
        inst.appendTo = function( element ) {
            element = meta.checkElement(element, "append to");
            element.append( inst.container );
            return inst;
        };

        // TODO split into destroy() and detach()
        // TODO should we hook into container's onRemove?
        inst.remove = function() {
            for (let cb of inst._onRemove ) {
                cb.bind(inst)();
            }
            inst.container.remove();
        };

        // resolve all needed elements at once
        const resolved = findClasses( container[0], this._wanted );
        inst.element  = {};
        for (let cls in resolved)
            inst.element[ this._wanted[cls] ] = window.$( resolved[cls] );

        for (let action of meta._setup) {
            action[1](inst, inst.element[ action[0] ]);
        }

        // process arguments & initial values
        for( let i in meta._init ) {
            // skip initializer for given arguments - but not for methods
            if (!isMethod[i] && i in args)
                continue;
            inst[i] = meta._init[i].apply(inst, [args]);
        }
        for( let key in args ) {
            // TODO throw all of extra args, not just the first
            if (!allowArgs[key] )
                blame( "unknown argument "+key);
            if (!assignArgs[key])
                continue;
            if (isMethod[key]) {
                inst[key]( args[key] );
            } else {
                inst[key] = args[key];
            }
        }

        // execute callbacks
        // TODO rewrite this
        for (let i in meta._onAttach ) {
            meta._onAttach[i].bind(inst)(args);
        }
        return inst;
    }; // end of this.attach

    this.appendTo = function( element, args ) {
        return this.instantiate(args).appendTo(element);
    };

    this.instantiate = function( args ) {
        // TODO this dies if >1 nodes, so move the check into html()
        if (!this._master)
            blame('Trying to instantiate with an empty html()');
        const container = window.$( this._master.cloneNode(true) );
        return this.attach( container, args );
    };
}

// empty constructor for instanceof'ing
// TODO how to do it better?
/**
*   @constructor
*   @this {jRna.Bound}
*
*   Do not call this directly. Use {@link jRna#attach} instead.
*/
jRna.Bound = function () {};

// prefix all CSS classes to avoid namespace pollution
jRna.prefix = 'jrna-';

jRna.documentTitle = function(...args) {
    const me = {};
    Object.defineProperty( me, 'update', {
        value: function() {
            window.document.title = args.join('');
            return me;
        }
    });

    // cosplay an array - but with a modification hook
    for (let i in args) {
        Object.defineProperty(me, i, {
            get: function() { return args[i] },
            set: function(val) { args[i] = val; this.update() },
            enumerable: true
        });
    }
    Object.defineProperty( me, 'length', {
        value: args.length
    });
    return me;
};

jRna.upload = function(options={}) {
    const inputFile = window.document.createElement('input');
    inputFile.setAttribute('type',   'file');
    inputFile.setAttribute('style',  'display: none');
    return new Promise( done => {
        inputFile.oninput = function() {
            jRna.uploadFile( this.files[0], options.type ).then( result => {
                inputFile.remove();
                done( result );
            });
        };
        window.document.body.appendChild(inputFile); // required for firefox
        inputFile.click();
    });
};

jRna.uploadFile = function ( file, type ) {
    const types = {
        text : 'readAsText',
        raw  : 'readAsBinaryString',
        url  : 'readAsDataUrl'
    };
    const how = types[ type || 'text' ];
    if (!how)
        throw new Error("uploadFile(): type must be 'text'(default), 'raw', or 'url'");
    const reader = new window.FileReader();
    return new Promise(function(done) {
        reader.onload = function () {
            let result = { content: reader.result, info: file };
            for (let key in file) {
                result[key] = file[key];
            }
            done(result);
        };
        reader[how](file);
    });
};

jRna.download = function(filename, content, ctype) {
    if (!ctype)
        ctype = 'application/octet-stream';
    // TODO also add charset=utf-8 unless binary

    // Shamelessly stolen from https://stackoverflow.com/a/30800715/280449
    const dataStr = 'data:'+ctype+','+encodeURIComponent( content );
    const aHref = window.document.createElement('a');
    aHref.setAttribute("href",     dataStr);
    aHref.setAttribute("download", filename);
    window.document.body.appendChild(aHref); // required for firefox
    aHref.click();
    aHref.remove();
};

jRna.backend = function(spec = {}) {
    const url = spec.url;
    if (!url)
        throw new Error("jRna.backend: 'url' parameter is required");

    const method = (spec.method || 'POST').toUpperCase();
    let content_type, parse, stringify;

    // TODO if type == json
    content_type = 'application/json';
    parse        = JSON.parse;
    stringify    = JSON.stringify;

    return function(args) {
        let query = '';
        return new Promise( function (done) {
            const xhr = new XMLHttpRequest();

            xhr.addEventListener( "load", function() {
                const data = parse(this.responseText);
                done(data);
            } );
            xhr.open(method, url + query);
            if (content_type)
                xhr.setRequestHeader( "Content-Type", content_type );
            xhr.send(stringify(args));
        } );
    };
};

// const switcheroo = jRna.stickySM( { state: onSwitch, ... }, ... ).run()
// switcheroo(same_state); // does nothing
// switcheroo(other_state); // executes respective onSwitch
// switcheroo(); // returns current state
jRna.stickySM = function( action_hash, args ) {
    // TODO validate args
    const origin = args.origin || '- jRna.stickySM@'+get_stack(2);

    if (args.initial !== undefined && !action_hash[args.initial])
        throw new Error("Illegal initial state: "+args.initial+' '+origin);

    return {
        run: function() {
            // TODO this.run(initial_state)
            let state = args.initial;

            return function(arg) {
                // 0-arg => getter
                if (typeof arg === 'undefined')
                    return state;

                // console.trace('switch '+state+'->'+arg);

                if (arg !== state) {
                    const todo = action_hash[arg];
                    if (!todo)
                        throw new Error('Illegal state switch '+state+'->'+arg +' '+origin);
                    todo.apply(this, [state, arg]); // (old, new)
                    state = arg;
                }
                return this;
            };
        }
    };
};

// usage:
// const [ elementName, propertyName ] = jRna.parseId ( string | [ string, string ] )
jRna.parseId = function(receptor, options={}) {
    let out;
    if (Array.isArray(receptor)) {
        if (receptor.length > 2)
            throw new Error( 'jRna receptor must be a string or 2-element array');
        out = [].concat(receptor);
    } else {
        out = [ receptor ]
    }
    if (typeof out[0] !== 'string' && typeof out[0] !== 'number')
        throw new Error( 'jRna receptor must be a string or 2-element array');
    if (out[1] === undefined && !options.skipMissing)
        out[1] = out[0];
    return out;
};

if (typeof module === 'object' && typeof module.exports === 'object' ) {
    // we're being exported
    module.exports = jRna;
}
