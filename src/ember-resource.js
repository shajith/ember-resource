(function(undefined) {

  window.Ember = window.Ember || window.SC;

  var expandSchema, expandSchemaItem, createSchemaProperties,
      mergeSchemas;

  function isString(obj) {
    return !!(obj === '' || (obj && obj !== String && obj.charCodeAt && obj.substr));
  }

  function isObject(obj) {
    return obj === Object(obj);
  }

  function K() {};

  Ember.Resource = Ember.Object.extend({
    resourcePropertyWillChange: K,
    resourcePropertyDidChange: K
  });

  Ember.Resource.deepSet = function(obj, path, value) {
    if (Ember.typeOf(path) === 'string') {
      Ember.Resource.deepSet(obj, path.split('.'), value);
      return;
    }

    var key = path.shift();

    if (path.length === 0) {
      Ember.set(obj, key, value);
    } else {
      var newObj = Ember.get(obj, key);

      if (newObj === null || newObj === undefined) {
        newObj = {};
        Ember.set(obj, key, newObj);
      }

      Ember.Resource.deepSet(newObj, path, value);
    }
  };

  Ember.Resource.deepMerge = function(objA, objB) {
    var oldValue, newValue;

    for (var key in objB) {
      if (objB.hasOwnProperty(key)) {
        oldValue = Ember.get(objA, key);
        newValue = Ember.get(objB, key);

        if (Ember.typeOf(newValue) === 'object' && Ember.typeOf(oldValue) === 'object') {
          Ember.Resource.deepMerge(oldValue, newValue);
        } else {
          Ember.set(objA, key, newValue);
        }
      }
    }
  };

  Ember.Resource.AbstractSchemaItem = Ember.Object.extend({
    name: Ember.required(String),
    fetchable: Ember.required(Boolean),
    getValue: Ember.required(Function),
    setValue: Ember.required(Function),

    dependencies: function() {
      return ['data.' + this.get('path'), 'isExpired'];
    }.property('path'),

    data: function(instance) {
      return Ember.get(instance, 'data');
    },

    type: function() {
      var type = this.get('theType');
      if (isString(type)) {
        type = Ember.getPath(type);
        if (type) {
          this.set('theType', type);
        } else {
          type = this.get('theType');
        }
      }
      return type;
    }.property('theType'),

    propertyFunction: function(name, value) {
      var schemaItem = this.constructor.schema[name];
      if (arguments.length === 2) {
        this.resourcePropertyWillChange(name, value);
        schemaItem.setValue.call(schemaItem, this, value);
        value = schemaItem.getValue.call(schemaItem, this);
        this.resourcePropertyDidChange(name, value);
      } else {
        value = schemaItem.getValue.call(schemaItem, this);
        if ((value === undefined || Ember.get(this, 'isExpired')) && schemaItem.get('fetchable')) {
          this.scheduleFetch();
        }
      }
      return value;
    },

    property: function() {
      return this.propertyFunction.property.apply(this.propertyFunction, this.get('dependencies')).cacheable();
    },

    toJSON: function(instance) {
      return undefined;
    }
  });
  Ember.Resource.AbstractSchemaItem.reopenClass({
    create: function(name, schema) {
      var instance = this._super.apply(this);
      instance.set('name', name);
      return instance;
    }
  });


  Ember.Resource.SchemaItem = Ember.Resource.AbstractSchemaItem.extend({});

  Ember.Resource.SchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];

      if (definition instanceof Ember.Resource.AbstractSchemaItem) { return definition; }

      var type;
      if (definition === Number || definition === String || definition === Boolean || definition === Date || definition === Object) {
        definition = {type: definition};
        schema[name] = definition;
      }

      if(isObject(definition)) {
        type = definition.type;
      }

      if (type) {
        if (type.isEmberResource || Ember.typeOf(type) === 'string') { // a has-one association
          return Ember.Resource.HasOneSchemaItem.create(name, schema);
        } else if(type.isEmberResourceCollection) { // a has-many association
          return Ember.Resource.HasManySchemaItem.create(name, schema);
        } else { // a regular attribute
          return Ember.Resource.AttributeSchemaItem.create(name, schema);
        }
      }
    }
  });

  Ember.Resource.AttributeSchemaItem = Ember.Resource.AbstractSchemaItem.extend({
    fetchable: true,
    theType: Object,
    path: Ember.required(String),

    getValue: function(instance) {
      var value;
      var data = this.data(instance);
      if (data) {
        value = Ember.getPath(data, this.get('path'));
      }

      if (this.typeCast) {
        value = this.typeCast(value);
      }

      return value;
    },

    setValue: function(instance, value) {
      var data = this.data(instance);
      if (!data) return;

      if (this.typeCast) {
        value = this.typeCast(value);
      }
      if (value !== null && value !== undefined && Ember.typeOf(value.toJSON) == 'function') {
        value = value.toJSON();
      }
      Ember.Resource.deepSet(data, this.get('path'), value);
    },

    toJSON: function(instance) {
      return Ember.get(instance, this.name);
    }
  });

  Ember.Resource.AttributeSchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];
      var instance;

      if (this === Ember.Resource.AttributeSchemaItem) {
        switch (definition.type) {
          case Number:
            return Ember.Resource.NumberAttributeSchemaItem.create(name, schema);
          case String:
            return Ember.Resource.StringAttributeSchemaItem.create(name, schema);
          case Boolean:
            return Ember.Resource.BooleanAttributeSchemaItem.create(name, schema);
          case Date:
            return Ember.Resource.DateAttributeSchemaItem.create(name, schema);
          default:
            instance = this._super.apply(this, arguments);
            instance.set('fetchable', name !== 'id');
            instance.set('path', definition.path || name);
            return instance;
        }
      }
      else {
        instance = this._super.apply(this, arguments);
        instance.set('fetchable', name !== 'id');
        instance.set('path', definition.path || name);
        return instance;
      }
    }
  });

  Ember.Resource.NumberAttributeSchemaItem = Ember.Resource.AttributeSchemaItem.extend({
    theType: Number,
    typeCast: function(value) {
      if (isNaN(value)) {
        value = undefined;
      }

      if (value === undefined || value === null || Ember.typeOf(value) === 'number') {
        return value;
      } else {
        return Number(value);
      }
    }
  });

  Ember.Resource.StringAttributeSchemaItem = Ember.Resource.AttributeSchemaItem.extend({
    theType: String,
    typeCast: function(value) {
      if (value === undefined || value === null || Ember.typeOf(value) === 'string') {
        return value;
      } else {
        return '' + value;
      }
    }
  });

  Ember.Resource.BooleanAttributeSchemaItem = Ember.Resource.AttributeSchemaItem.extend({
    theType: Boolean,
    typeCast: function(value) {
      if (value === undefined || value === null || Ember.typeOf(value) === 'boolean') {
        return value;
      } else {
        return value === 'true';
      }
    }
  });

  Ember.Resource.DateAttributeSchemaItem = Ember.Resource.AttributeSchemaItem.extend({
    theType: Date,
    typeCast: function(value) {
      if (value === undefined || value === null || Ember.typeOf(value) === 'date') {
        return value;
      } else {
        return new Date(value);
      }
    },
    toJSON: function(instance) {
      var value = Ember.get(instance, this.name);
      return value ? value.toJSON() : value;
    }
  });

  Ember.Resource.HasOneSchemaItem = Ember.Resource.AbstractSchemaItem.extend({
    fetchable: true
  });
  Ember.Resource.HasOneSchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];
      if (this === Ember.Resource.HasOneSchemaItem) {
        if (definition.nested) {
          return Ember.Resource.HasOneNestedSchemaItem.create(name, schema);
        } else {
          return Ember.Resource.HasOneRemoteSchemaItem.create(name, schema);
        }
      }
      else {
        var instance = this._super.apply(this, arguments);
        instance.set('theType', definition.type);
        if (definition.parse) {
          instance.set('parse', definition.parse);
        }
        return instance;
      }
    }
  });

  Ember.Resource.HasOneNestedSchemaItem = Ember.Resource.HasOneSchemaItem.extend({
    getValue: function(instance) {
      var data = this.data(instance);
      if (!data) return;
      var type = this.get('type');
      var value = Ember.getPath(data, this.get('path'));
      if (value) {
        value = (this.get('parse') || type.parse).call(type, Ember.copy(value));
        return type.create({}, value);
      }
      return value;
    },

    setValue: function(instance, value) {
      var data = this.data(instance);
      if (!data) return;

      if (value instanceof this.get('type')) {
        value = Ember.get(value, 'data');
      }

      Ember.Resource.deepSet(data, this.get('path'), value);
    },

    toJSON: function(instance) {
      var value = Ember.get(instance, this.name);
      return value ? value.toJSON() : value;
    }
  });
  Ember.Resource.HasOneNestedSchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];
      var instance = this._super.apply(this, arguments);
      instance.set('path', definition.path || name);

      var id_name = name + '_id';
      if (!schema[id_name]) {
        schema[id_name] = {type: Number, association: instance };
        schema[id_name] = Ember.Resource.HasOneNestedIdSchemaItem.create(id_name, schema);
      }

      return instance;
    }
  });
  Ember.Resource.HasOneNestedIdSchemaItem = Ember.Resource.AbstractSchemaItem.extend({
    fetchable: true,
    theType: Number,
    getValue: function(instance) {
      return instance.getPath(this.get('path'));
    },
    setValue: function(instance, value) {
      Ember.set(instance, this.getPath('association.name'), {id: value});
    }
  });
  Ember.Resource.HasOneNestedIdSchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];
      var instance = this._super.apply(this, arguments);
      instance.set('association', definition.association);
      instance.set('path', definition.association.get('path') + '.id');
      return instance;
    }
  });


  Ember.Resource.HasOneRemoteSchemaItem = Ember.Resource.HasOneSchemaItem.extend({
    getValue: function(instance) {
      var data = this.data(instance);
      if (!data) return;
      var id = Ember.getPath(data, this.get('path'));
      if (id) {
        return this.get('type').create({}, {id: id});
      }
    },

    setValue: function(instance, value) {
      var data = this.data(instance);
      if (!data) return;
      var id = Ember.get(value || {}, 'id');
      Ember.Resource.deepSet(data, this.get('path'), id);
    }
  });
  Ember.Resource.HasOneRemoteSchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];
      var instance = this._super.apply(this, arguments);
      var path = definition.path || name + '_id';
      instance.set('path', path);

      if (!schema[path]) {
        schema[path] = Number;
        schema[path] = Ember.Resource.SchemaItem.create(path, schema);
      }

      return instance;
    }
  });


  Ember.Resource.HasManySchemaItem = Ember.Resource.AbstractSchemaItem.extend({
    itemType: function() {
      var type = this.get('theItemType');
      if (isString(type)) {
        type = Ember.getPath(type);
        if (type) {
          this.set('theItemType', type);
        } else {
          type = this.get('theItemType');
        }
      }
      return type;
    }.property('theItemType')
  });
  Ember.Resource.HasManySchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];
      if (this === Ember.Resource.HasManySchemaItem) {
        if (definition.url) {
          return Ember.Resource.HasManyRemoteSchemaItem.create(name, schema);
        } else if (definition.nested) {
          return Ember.Resource.HasManyNestedSchemaItem.create(name, schema);
        } else {
          return Ember.Resource.HasManyInArraySchemaItem.create(name, schema);
        }
      } else {
        var instance = this._super.apply(this, arguments);
        instance.set('theType', definition.type);
        instance.set('theItemType', definition.itemType);
        if (definition.parse) {
          instance.set('parse', definition.parse);
        }
        return instance;
      }
    }
  });

  Ember.Resource.HasManyRemoteSchemaItem = Ember.Resource.HasManySchemaItem.extend({
    fetchable: false,
    dependencies: ['id', 'isInitializing'],
    getValue: function(instance) {
      if (Ember.get(instance, 'isInitializing')) return;

      var options = {
        type: this.get('itemType')
      };

      if (this.get('parse')) options.parse = this.get('parse');

      var url = this.url(instance);
      if (url) {
        options.url = url;
      } else {
        options.content = [];
      }

      return this.get('type').create(options);
    },

    setValue: function(instance, value) {
      throw('you can not set a remote has many association');
    }
  });
  Ember.Resource.HasManyRemoteSchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];

      var instance = this._super.apply(this, arguments);

      if (Ember.typeOf(definition.url) === 'function') {
        instance.url = definition.url;
      } else {
        instance.url = function(obj) {
          var id = obj.get('id');
          if (id) {
            return definition.url.fmt(id);
          }
        };
      }

      return instance;
    }
  });

  Ember.Resource.HasManyNestedSchemaItem = Ember.Resource.HasManySchemaItem.extend({
    fetchable: true,
    getValue: function(instance) {
      var data = this.data(instance);
      if (!data) return;
      data = Ember.getPath(data, this.get('path'));
      if (data === undefined || data === null) return data;
      data = Ember.copy(data);

      var options = {
        type: this.get('itemType'),
        content: data
      };

      if (this.get('parse')) options.parse = this.get('parse');

      return this.get('type').create(options);
    },

    setValue: function(instance, value) {
    },

    toJSON: function(instance) {
      var value = Ember.get(instance, this.name);
      return value ? value.toJSON() : value;
    }
  });
  Ember.Resource.HasManyNestedSchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];

      var instance = this._super.apply(this, arguments);
      instance.set('path', definition.path || name);

      return instance;
    }
  });

  Ember.Resource.HasManyInArraySchemaItem = Ember.Resource.HasManySchemaItem.extend({
    fetchable: true,
    getValue: function(instance) {
      var data = this.data(instance);
      if (!data) return;
      data = Ember.getPath(data, this.get('path'));
      if (data === undefined || data === null) return data;


      return this.get('type').create({
        type: this.get('itemType'),
        content: data.map(function(id) { return {id: id}; })
      });
    },

    setValue: function(instance, value) {
    },

    toJSON: function(instance) {
      var value = Ember.get(instance, this.name);
      return value ? value.mapProperty('id') : value;
    }
  });
  Ember.Resource.HasManyInArraySchemaItem.reopenClass({
    create: function(name, schema) {
      var definition = schema[name];

      var instance = this._super.apply(this, arguments);
      instance.set('path', definition.path || name + '_ids');

      return instance;
    }
  });


  // Gives custom error handlers access to the resource object.
  // 1. `this` will refer to the Ember.Resource object.
  // 2. `resource` will be passed as the last argument
  //
  //     function errorHandler() {
  //       this; // the Ember.Resource
  //     }
  //
  //     function errorHandler(jqXHR, textStatus, errorThrown, resource) {
  //       resource; // another way to reference the resource object
  //     }
  //
  var errorHandlerWithModel = function(errorHandler, resource) {
    return function() {
      var args = Array.prototype.slice.call(arguments, 0);
      args.push(resource);
      errorHandler.apply(resource, args);
    };
  };

  Ember.Resource.ajax = function(options) {
    options.dataType = options.dataType || 'json';
    options.type     = options.type     || 'GET';

    if (!options.error && Ember.Resource.errorHandler) {
      if (options.resource) {
        options.error = errorHandlerWithModel(Ember.Resource.errorHandler, options.resource);
        delete options.resource;
      } else {
        options.error = Ember.Resource.errorHandler;
      }
    }

    return $.ajax(options);
  };

  Ember.Resource.Lifecycle = {
    INITIALIZING: 0,
    UNFETCHED:    10,
    EXPIRING:     20,
    EXPIRED:      30,
    FETCHING:     40,
    FETCHED:      50,
    SAVING:       60,
    DESTROYING:   70,
    DESTROYED:    80,

    clock: Ember.Object.create({
      now: new Date(),

      tick: function() {
        Ember.Resource.Lifecycle.clock.set('now', new Date());
      },

      start: function() {
        this.stop();
        Ember.Resource.Lifecycle.clock.set('timer', setInterval(Ember.Resource.Lifecycle.clock.tick, 10000));
      },

      stop: function() {
        var timer = Ember.Resource.Lifecycle.clock.get('timer');
        if (timer) {
          clearInterval(timer);
        }
      }
    }),

    classMixin: Ember.Mixin.create({
      create: function(options, data) {
        options = options || {};
        options.resourceState = Ember.Resource.Lifecycle.INITIALIZING;

        var instance = this._super.apply(this, arguments);

        if (Ember.get(instance, 'resourceState') === Ember.Resource.Lifecycle.INITIALIZING) {
          Ember.set(instance, 'resourceState', Ember.Resource.Lifecycle.UNFETCHED);
        }

        return instance;
      }
    }),

    prototypeMixin: Ember.Mixin.create({
      expireIn: 60 * 5,
      resourceState: 0,
      autoFetch: true,

      init: function() {
        this._super.apply(this, arguments);

        var self = this;

        var updateExpiry = function() {
          var expireAt = new Date();
          expireAt.setSeconds(expireAt.getSeconds() + Ember.get(self, 'expireIn'));
          Ember.set(self, 'expireAt', expireAt);
        };

        Ember.addListener(this, 'willFetch', this, function() {
          Ember.set(self, 'resourceState', Ember.Resource.Lifecycle.FETCHING);
          updateExpiry();
        });

        Ember.addListener(this, 'didFetch', this, function() {
          Ember.set(self, 'resourceState', Ember.Resource.Lifecycle.FETCHED);
          updateExpiry();
        });

        var resourceStateBeforeSave;
        Ember.addListener(this, 'willSave', this, function() {
          resourceStateBeforeSave = Ember.get(self, 'resourceState');
          Ember.set(self, 'resourceState', Ember.Resource.Lifecycle.SAVING);
        });

        Ember.addListener(this, 'didSave', this, function() {
          Ember.set(self, 'resourceState', resourceStateBeforeSave || Ember.Resource.Lifecycle.UNFETCHED);
        });
      },

      isFetchable: function() {
        var state = Ember.get(this, 'resourceState');
        return state == Ember.Resource.Lifecycle.UNFETCHED || state === Ember.Resource.Lifecycle.EXPIRED;
      }.property('resourceState').cacheable(),

      isAutoFetchable: function() {
        return this.get('isFetchable') && this.get('autoFetch');
      }.property('isFetchable', 'autoFetch').cacheable(),

      isInitializing: function() {
        return (Ember.get(this, 'resourceState') || Ember.Resource.Lifecycle.INITIALIZING) === Ember.Resource.Lifecycle.INITIALIZING;
      }.property('resourceState').cacheable(),

      isFetching: function() {
        return (Ember.get(this, 'resourceState')) === Ember.Resource.Lifecycle.FETCHING;
      }.property('resourceState').cacheable(),

      isFetched: function() {
        return (Ember.get(this, 'resourceState')) === Ember.Resource.Lifecycle.FETCHED;
      }.property('resourceState').cacheable(),

      isSavable: function() {
        var state = Ember.get(this, 'resourceState');
        var unsavableState = [
          Ember.Resource.Lifecycle.INITIALIZING,
          Ember.Resource.Lifecycle.FETCHING,
          Ember.Resource.Lifecycle.SAVING,
          Ember.Resource.Lifecycle.DESTROYING
        ];

        return state && !unsavableState.contains(state);
      }.property('resourceState').cacheable(),

      scheduleFetch: function() {
        if (Ember.get(this, 'isAutoFetchable')) {
          Ember.run.next(this, this.fetch);
        }
      },

      expire: function() {
        Ember.run.next(this, function() {
          Ember.set(this, 'expireAt', new Date());
          Ember.Resource.Lifecycle.clock.tick();
        });
      },

      updateIsExpired: function() {
        var isExpired = Ember.get(this, 'resourceState') === Ember.Resource.Lifecycle.EXPIRED;
        if (isExpired) return true;

        var expireAt = Ember.get(this, 'expireAt');
        if (expireAt) {
          var now = Ember.Resource.Lifecycle.clock.get('now');
          isExpired = expireAt.getTime() <= now.getTime();
        }

        if (isExpired !== Ember.get(this, 'isExpired')) {
          Ember.set(this, 'isExpired', isExpired);
        }
      }.observes('Ember.Resource.Lifecycle.clock.now', 'expireAt', 'resourceState'),

      isExpired: function(name, value) {
        if (value) {
          Ember.set(this, 'resourceState', Ember.Resource.Lifecycle.EXPIRED);
        }
        return value;
      }.property().cacheable()
    })
  };
  Ember.Resource.Lifecycle.clock.start();

  Ember.Resource.reopen({
    isEmberResource: true,

    updateWithApiData: function(json) {
      var data = Ember.get(this, 'data');
      Ember.beginPropertyChanges(data);
      Ember.Resource.deepMerge(data, this.constructor.parse(json));
      Ember.endPropertyChanges(data);
    },

    willFetch: function() {},
    didFetch: function() {},
    willSave: function() {},
    didSave: function() {},

    fetch: function() {
      if (!Ember.get(this, 'isFetchable')) return $.when();

      var url = this.resourceURL();

      if (!url) return;

      var self = this;

      if (this.deferedFetch && !Ember.get(this, 'isExpired')) return this.deferedFetch;

      self.willFetch.call(self);
      Ember.sendEvent(self, 'willFetch');

      this.deferedFetch = Ember.Resource.ajax({
        url: url,
        success: function(json) {
          self.updateWithApiData(json);
        }
      });

      this.deferedFetch.always(function() {
        self.didFetch.call(self);
        Ember.sendEvent(self, 'didFetch');
      });

      return this.deferedFetch;
    },

    resourceURL: function() {
      return this.constructor.resourceURL(this);
    },

    // Turn this resource into a JSON object to be saved via AJAX. Override
    // this method to produce different syncing behavior.
    toJSON: function() {
      var json = {};
      var schemaItem, path, value;
      for (var name in this.constructor.schema) {
        if (this.constructor.schema.hasOwnProperty(name)) {
          schemaItem = this.constructor.schema[name];
          if (schemaItem instanceof Ember.Resource.AbstractSchemaItem) {
            path = schemaItem.get('path');
            value = schemaItem.toJSON(this);
            if (value !== undefined) {
              Ember.Resource.deepSet(json, path, value);
            }
          }
        }
      }

      return json;
    },

    isNew: function() {
      return !Ember.get(this, 'id');
    }.property('id').cacheable(),

    save: function(options) {
      options = options || {};
      if (!Ember.get(this, 'isSavable')) return false;

      var ajaxOptions = {
        contentType: 'application/json',
        data: JSON.stringify(this.toJSON()),
        resource: this
      };

      if (Ember.get(this, 'isNew')) {
        ajaxOptions.type = 'POST';
        ajaxOptions.url = this.constructor.resourceURL();
      } else {
        ajaxOptions.type = 'PUT';
        ajaxOptions.url = this.resourceURL();
      }

      var self = this;

      self.willSave.call(self);
      Ember.sendEvent(self, 'willSave');

      var deferedSave = Ember.Resource.ajax(ajaxOptions);

      deferedSave.done(function(data, status, response) {
        var location = response.getResponseHeader('Location');
        if (location) {
          var id = self.constructor.idFromURL(location);
          if (id) {
            Ember.set(self, 'id', id);
          }
        }

        if (options.update !== false && Ember.typeOf(data) === 'object') {
          self.updateWithApiData(data);
        }
      });

      deferedSave.always(function() {
        self.didSave.call(self);
        Ember.sendEvent(self, 'didSave');
      });

      return deferedSave;
    },

    destroy: function() {
      var previousState = Ember.get(this, 'resourceState'), self = this;
      Ember.set(this, 'resourceState', Ember.Resource.Lifecycle.DESTROYING);
      return Ember.Resource.ajax({
        type: 'DELETE',
        url:  this.resourceURL(),
        resource: this
      }).done(function() {
        Ember.set(self, 'resourceState', Ember.Resource.Lifecycle.DESTROYED);
      }).fail(function() {
        Ember.set(self, 'resourceState', previousState);
      });
    }
  }, Ember.Resource.Lifecycle.prototypeMixin);

  expandSchema = function(schema) {
    for (var name in schema) {
      if (schema.hasOwnProperty(name)) {
        schema[name] = Ember.Resource.SchemaItem.create(name, schema);
      }
    }

    return schema;
  };

  mergeSchemas = function(childSchema, parentSchema) {
    var schema = Ember.copy(parentSchema || {});

    for (var name in childSchema) {
      if (childSchema.hasOwnProperty(name)) {
        if (schema.hasOwnProperty(name)) {
          throw("Schema item '" + name + "' is already defined");
        }

        schema[name] = childSchema[name];
      }
    }

    return schema;
  };

  createSchemaProperties = function(schema) {
    var properties = {}, schemaItem;

    for (var propertyName in schema) {
      if (schema.hasOwnProperty(propertyName)) {
        properties[propertyName] = schema[propertyName].property();
      }
    }

    return properties;
  };

  Ember.Resource.reopenClass({
    isEmberResource: true,
    schema: {},

    baseClass: function() {
      if (this === Ember.Resource) {
        return null;
      } else {
        return this.baseResourceClass || this;
      }
    },

    subclassFor: function(options, data) {
      return this;
    },

    // Create an instance of this resource. If `options` includes an
    // `id`, first check the identity map and return the existing resource
    // with that ID if found.
    create: function(options, data) {
      data    = data    || {};
      options = options || {};

      var klass = this.subclassFor(options, data);

      if (klass === this) {
        var instance;
        this.identityMap = this.identityMap || {};

        var id = data.id || options.id;
        if (id && !options.skipIdentityMap) {
          id = id.toString();
          instance = this.identityMap[id];

          if (!instance) {
            this.identityMap[id] = instance = this._super.call(this, { data: data });
          } else {
            instance.updateWithApiData(data);
          }
        } else {
          instance = this._super.call(this, { data: data });
        }

        delete options.data;

        Ember.beginPropertyChanges(instance);
        var mixin = {};
        var hasMixin = false;
        for (var name in options) {
          if (options.hasOwnProperty(name)) {
            if (this.schema[name]) {
              instance.set(name, options[name]);
            } else {
              mixin[name] = options[name];
              hasMixin = true;
            }
          }
        }
        if (hasMixin) {
          instance.reopen(mixin);
        }
        Ember.endPropertyChanges(instance);

        return instance;
      } else {
        return klass.create(options, data);
      }
    },

    // Parse JSON -- likely returned from an AJAX call -- into the
    // properties for an instance of this resource. Override this method
    // to produce different parsing behavior.
    parse: function(json) {
      return json;
    },

    // Define a resource class.
    //
    // Parameters:
    //
    //  * `schema` -- the properties schema for the resource class
    //  * `url` -- either a function that returns the URL for syncing
    //    resources or a string. If the latter, a string of the form
    //    "/widgets" is turned into a function that returns "/widgets" if
    //    the Widget's ID is not present and "/widgets/{id}" if it is.
    //  * `parse` -- the function used to parse JSON returned from AJAX
    //    calls into the resource properties. By default, simply returns
    //    the JSON.
    define: function(options) {
      options = options || {};
      var schema = expandSchema(options.schema);
      schema = mergeSchemas(schema, this.schema);

      var klass = this.extend(createSchemaProperties(schema));

      var classOptions = {
        schema: schema
      };

      if (this !== Ember.Resource) {
        classOptions.baseResourceClass = this.baseClass() || this;
      }

      if (options.url) {
        classOptions.url = options.url;
      }

      if (options.parse) {
        classOptions.parse = options.parse;
      }

      klass.reopenClass(classOptions);

      return klass;
    },

    resourceURL: function(instance) {
      if (Ember.typeOf(this.url) == 'function') {
        return this.url(instance);
      } else if (this.url) {
        if (instance) {
          var id = Ember.get(instance, 'id');
          if (id && (Ember.typeOf(id) !== 'number' || id > 0)) {
            return this.url + '/' + id;
          }
        } else {
          return this.url;
        }
      }
    },

    idFromURL: function(url) {
      var regex;
      if (!this.schema.id) return;

      if (this.schema.id.get('type') === Number) {
        regex = /\/(\d+)(\.\w+)?$/;
      } else {
        regex = /\/([^\/\.]+)(\.\w+)?$/;
      }

      var match = (url || '').match(regex);
      if (match) {
        return match[1];
      }
    }
  }, Ember.Resource.Lifecycle.classMixin);

  Ember.ResourceCollection = Ember.ArrayProxy.extend({
    isEmberResourceCollection: true,
    type: Ember.required(),
    fetch: function() {
      if (!Ember.get(this, 'isFetchable')) return $.when();

      if (!this.prePopulated) {
        var self = this;

        if (this.deferedFetch && !Ember.get(this, 'isExpired')) return this.deferedFetch;

        Ember.sendEvent(self, 'willFetch');

        this.deferedFetch = this._fetch(function(json) {
          Ember.set(self, 'content', self.parse(json));
        });

        this.deferedFetch.always(function() {
          Ember.sendEvent(self, 'didFetch');
        });
      }
      return this.deferedFetch;
    },
    _resolveType: function() {
      if (isString(this.type)) {
        var type = Ember.getPath(this.type);
        if (type) this.type = type;
      }
    },
    _fetch: function(callback) {
      this._resolveType();
      return Ember.Resource.ajax({
        url: this.resolveUrl(),
        success: callback
      });
    },
    resolveUrl: function() {
      return this.get('url') || this.type.resourceURL();
    },
    instantiateItems: function(items) {
      this._resolveType();
      return items.map(function(item) {
        if (item instanceof this.type) {
          return item;
        } else {
          return this.type.create({}, item);
        }
      }, this);
    },
    parse: function(json) {
      this._resolveType();
      if (Ember.typeOf(this.type.parse) == 'function') {
        return json.map(this.type.parse);
      }
      else {
        return json;
      }
    },
    length: function() {
      var content = Ember.get(this, 'content');
      var length = content ? Ember.get(content, 'length') : 0;
      if (length === 0 ||  Ember.get(this, 'isExpired'))  this.scheduleFetch();
      return length;
    }.property('content.length', 'resourceState', 'isExpired').cacheable(),
    content: function(name, value) {
      if (arguments.length === 2) { // setter
        return this.instantiateItems(value);
      }
    }.property().cacheable(),

    autoFetchOnExpiry: function() {
      if (Ember.get(this, 'isExpired') && Ember.get(this, 'hasArrayObservers')) {
        this.fetch();
      }
    }.observes('isExpired', 'hasArrayObservers'),

    toJSON: function() {
      return this.map(function(item) {
        return item.toJSON();
      })
    }
  }, Ember.Resource.Lifecycle.prototypeMixin);

  Ember.ResourceCollection.reopenClass({
    isEmberResourceCollection: true,
    create: function(options) {
      options = options || {};
      var content = options.content;
      delete options.content;

      options.prePopulated = !! content;

      var instance;

      if (!options.prePopulated && options.url) {
        this.identityMap = this.identityMap || {};
        var identity = [options.type, options.url];
        instance = this.identityMap[identity] || this._super.call(this, options);
        this.identityMap[identity] = instance;
      }

      if (!instance) {
        instance = this._super.call(this, options);

        if (content) {
          Ember.set(instance, 'content', instance.parse(content));
        }
      }

      return instance;
    }
  }, Ember.Resource.Lifecycle.classMixin);
}());
