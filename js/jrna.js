/*
 *  jRna.js - interactive stateful UI widgets
 */
"use strict";

/*
First of all, some macros for jsdoc because it's too boring to write it every time

@macro oneof
    one of {@link jRna#attach attach}, {@link jRna#appendTo appendTo},
    or {@link jRna#spawn spawn}
@end oneof

@macro mutator name
    @function $(name)
    @memberOf jRna
    @instance
    @returns {jRna} The object itself. Chainable
@end mutator

@macro chainable
    @returns {jRna} The object itself. Chainable
@end chainable

@macro id
    @param {string} id - the jrna-prefixed class of the element to work on
@end id

@macro xprop what
    @param {string} name - the name of $(what) to create
@end xprop

@macro xpropid what
    @param {string} [name] - the name of $(what) to create.
    Defaults to the 'id' argument
@end xpropid

@macro callback arg
    @param {function} callback($(arg)) - run this code with jRna instance as this
@end callback

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
*       or {@link jRna#spawn spawn}
*   @end oneof
*   methods.
*
*   @constructor
*   @this {jRna}
*/
function jRna () {
    this.origin = get_stack(2);
    this.throw  = function(error) {
        throw new Error( error + " - jRna@"+this.origin );
    };

    // const parseHTML = $.parseHTML || function() { ... }
    const parseHTML = function(str) {
        const fakeHTML = window.document.createElement('div');
        fakeHTML.setAttribute( 'style', 'display: none' );
        fakeHTML.innerHTML = str;
        if (!fakeHTML.firstChild)
            this.throw("Attempt to use empty HTML");
        if (fakeHTML.firstChild != fakeHTML.lastChild) {
            this.throw("Attempt to create multiple tag HTML");
        }
        return fakeHTML.firstChild;
    };

    this._known = {};
    for (let i of [ 'appendTo', 'container', 'element', 'id', 'onAttach', 'onRemove', 'remove' ])
        this._known[i] = true;
    this.lockName = function (name, shared) {
        if (this._known[name] && this._known[name] !== shared) {
            this.throw( "Property name already in use: "+name );
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
    *      @returns {jRna} The object itself. Chainable
    *  @end mutator
    *  @param {string} html - must contain exactly one root node
    */
    this.html = function( html ) {
        if (html) {
            const container = window.$( parseHTML( html ) );
            this.checkElement(container, 'accept html() that is');
        }
        this._html = html || undefined;
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
    *      @returns {jRna} The object itself. Chainable
    *  @end mutator
    *  @param {string|jQuery} selector - where to search for the root element
    */
    this.htmlFrom = function(selector) {
        selector = this.checkElement(selector, "get HTML from");
        this._html = selector[0].outerHTML;
        return this;
    };

    /**
    *  Specify one or more optional argument keys for
    *  @oneof
    *      one of {@link jRna#attach attach}, {@link jRna#appendTo appendTo},
    *      or {@link jRna#spawn spawn}
    *  @end oneof
    *  methods.
    *  May be called more than once.
    *  By default, only 'id' argument is allowed.
    *
    *  @mutator args
    *      @function args
    *      @memberOf jRna
    *      @instance
    *      @returns {jRna} The object itself. Chainable
    *  @end mutator
    *  @param {...string} argumentName - list of allowed arguments
    */
    // forbid 'special' arguments, expect for 'id'
    // TODO v2.0 forbid overriding methods or r/o properties with args
    const noArgs = {}
    for (let i in this._known)
        noArgs[i] = true;
    const allowArgs = { id : true };
    const assignArgs = { id : true };

    this.addArgument = function( name, spec={} ) {
        if (spec.forbidden) {
            // special case
            if (allowArgs[name])
                this.throw( 'Forbidden argument name: '+name );
            noArgs[name] = true;
            return this;
        }

        if (noArgs[name])
            this.throw( 'Forbidden argument name: '+name );
        allowArgs [name] = true;
        assignArgs[name] = spec.assign;
        // TODO more fancy stuff
        return this;
    };

    this.args = function(...list) {
        // TODO think about required args & type checks
        for( let i of list )
            this.addArgument( i, { assign: true } );
        return this;
    };

    // perform action( instance, container.find(id) ) on instance creation
    this._setup = [];
    this.setup = function( id, action ) {
        this._setup.push( [id, action ] );
        return this;
    };

    const curry = (function(item, spec) {
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
        this.throw( 'Unexpected callback argument' );
    }).bind(this);

    /**
    *    Create a writable property. Update will trigger setting the text
    *    content of the affected DOM element.
    *    @mutator output
    *        @function output
    *        @memberOf jRna
    *        @instance
    *        @returns {jRna} The object itself. Chainable
    *    @end mutator
    *    @id
    *        @param {string} id - the jrna-prefixed class of the element to work on
    *    @end id
    *    @xpropid property
    *        @param {string} [name] - the name of property to create.
    *        Defaults to the 'id' argument
    *    @end xpropid
    */

    this.output = function( id, name ) {
        if (!name)
            name = id;
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
    *    @mutator output
    *        @function output
    *        @memberOf jRna
    *        @instance
    *        @returns {jRna} The object itself. Chainable
    *    @end mutator
    *    @id
    *        @param {string} id - the jrna-prefixed class of the element to work on
    *    @end id
    *    @xpropid property
    *        @param {string} [name] - the name of property to create.
    *        Defaults to the 'id' argument
    *    @end xpropid
    */
    this.rawOutput = function( id, name ) {
        if (!name)
            name = id;
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
    *        @returns {jRna} The object itself. Chainable
    *    @end mutator
    *    @id
    *        @param {string} id - the jrna-prefixed class of the element to work on
    *    @end id
    *    @xpropid property
    *        @param {string} [name] - the name of property to create.
    *        Defaults to the 'id' argument
    *    @end xpropid
    */
    this.input = function( id, name ) {
        if (!name)
            name = id;
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
    *       @returns {jRna} The object itself. Chainable
    *   @end mutator
    *   @id
    *       @param {string} id - the jrna-prefixed class of the element to work on
    *   @end id
    *   @callback
    *       @param {function} callback() - run this code with jRna instance as this
    *   @end callback
    */
    this.click = function( id, cb ) {
        return this.setup( id, function( inst, element ) {
            const bound = curry( inst, cb );
            element.on( 'click', function (ev) { bound(ev); return false; } );
        } );
    };
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
    this.element = function ( id, name ) {
        if (!name)
            name = id;
        this.lockName(name);
        this.addArgument(name, { forbidden: 1 });
        return this.setup( id, function( inst, element ) {
            inst[name] = element;
        } );
    };
    this.on = function( trigger, id, cb ) {
        return this.setup(id, function(inst, element) {
            const bound = curry( inst, cb );
            element.on(trigger, bound);
        });
    };
    this.upload = function( id, name, type ) {
        if (!name)
            name = id;
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

    this._init = {};
    this.def = function( name, action ) {
        this.lockName(name);
        if (typeof action === 'function')
            isMethod[name] = true;
        this._init[name] = function() { return action; };
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
        // TODO validate action_hash & initial values
        const me = this;

        if (typeof initial != 'undefined' && !action_hash[initial])
            this.throw("Illegal initial state "+initial);

        isMethod[name] = true;
        // must use init to avoid sharing state between instances
        this.init( name, function() {
            let state = initial;
            return function(arg) {
                // 0-arg => getter
                if (typeof arg == 'undefined')
                    return state;

                if (arg != state) {
                    const todo = action_hash[''+arg];
                    if (!todo)
                        me.throw('Illegal state switch for '+name+': '+state+'->'+arg);
                    todo.bind(this)(state, arg); // (old, new)
                    state = arg;
                }
                return this;
            };
        });
        return this;
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
        if (!element)
            this.throw( "Cannot "+action+" a null element");

        let selector = '';
        if (typeof element == 'string') {
            selector = ' $('+element+')';
            element = window.$( element );
        }
        if (!(element instanceof window.$))
            this.throw( "Cannot "+action+" a non-$ object" );
        if (!element.length)
            this.throw( "Cannot "+action+" a missing element"+selector );
        if ( element.length > 1)
            this.throw( "Cannot "+action+" an ambiguous element"+selector );
        return element.first();
    };

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
        for (let action of meta._setup) {
            const cls = jRna.prefix+action[0];
            let all = container.find( '.'+cls );
            // this is ugly! find() omits the container itself,
            // but we may need it for the sake of minimalism
            if (container.hasClass(cls))
                all = container.add(all);
            meta.checkElement(all, 'fulfill .'+cls+' with');
            action[1](inst, all);
            inst.element[action[0]] = all;
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
                meta.throw( "unknown argument "+key);
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
        return this.spawn(args).appendTo(element);
    };

    this.spawn = function( args ) {
        // TODO this dies if >1 nodes, so move the check into html()
        if (!this._html)
            this.throw('Trying to spawn with an empty html()');
        const container = window.$( parseHTML( this._html ) );
        this.checkElement(container, 'spawn() while html() is');
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

if (typeof module === 'object' && typeof module.exports === 'object' ) {
    // we're being exported
    module.exports = jRna;
}
