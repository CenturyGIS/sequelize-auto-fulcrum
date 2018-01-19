var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var async = require('async');
var Fulcrum = require('fulcrum-app');
var FulcrumCore = require('fulcrum-core');

function AutoFulcrum (key, formId, parent, options) {
  this.apiKey = key;
  this.formId = formId;
  this.parent = parent;
  // this.tables = {};
  // this.foreignKeys = {};
  this.geoEnabled = {};

  var defaultConfig = {
    spaces: true,
    indentation: 2,
    directory: './models',
    additional: {},
  };

  this.options = _.extend({}, defaultConfig, options || {});
}

AutoFulcrum.prototype.build = function (callback) {

  var self = this;

  var fulcrum = new Fulcrum({
    api_key: this.apiKey
  });

  fulcrum.forms.find(this.formId, formFound);

  function formFound (error, response) {

    if (error) {
      return console.log('Error: ', error);
    }

    self.form = new FulcrumCore.Form(response.form);

    var filtered = _.reject(self.form.allElements, function (e) {
      return e.isSectionElement || e.isLabelElement;
    });

    self.tables = _.groupBy(filtered, function (el) {

      var parent = el.parent;
      while (true) {
        if (parent.isRepeatableElement || parent instanceof FulcrumCore.Form) {
          break;
        }
        parent = parent.parent;
      }

      return parent.dataName || self.parent;
    });

    // track which tables are geo-enabled
    self.geoEnabled[self.parent] = self.form.isGeometryEnabled;

    // track which fields are record linked as a 1:m
    self.recordLinked = [];

    _.forEach(self.form.allElements, function (el) {
      if (el.isRepeatableElement) {
        self.geoEnabled[el.dataName] = el.isGeometryEnabled;
      }

      if (el.isRecordLinkElement && el.allowMultiple) {
        self.recordLinked.push(el.dataName);
      }
    });

    return callback();
  }
};

AutoFulcrum.prototype.run = function (callback) {

  var self = this;
  var text = {};

  this.build(function () {

    var spaces = '';
    for (var x = 0; x < self.options.indentation; ++x) {
      spaces += (self.options.spaces === true ? ' ' : '\t');
    }

    async.each(_.keys(self.tables), function (table, _callback) {
      var fields = self.tables[table];
      var capitalized = _.capitalize(table);

      text[table] = 'module.exports = function(sequelize, DataTypes) {\n';
      text[table] += spaces + 'var ' + capitalized + ' = sequelize.define(\'' + table + '\', {\n';

      // Fulcrum ID (primary key)
      text[table] += spaces + spaces + 'fulcrum_id: {\n';
      text[table] += spaces + spaces + spaces + 'primaryKey: true,\n';
      text[table] += spaces + spaces + spaces + 'type: DataTypes.STRING(100),\n';
      text[table] += spaces + spaces + spaces + 'comment: \'Fulcrum ID\',\n';
      text[table] += spaces + spaces + '},\n';

      // duration
      text[table] += spaces + spaces + 'created_duration: DataTypes.TEXT,\n';
      text[table] += spaces + spaces + 'updated_duration: DataTypes.TEXT,\n';
      text[table] += spaces + spaces + 'edited_duration: DataTypes.TEXT,\n';

      // cloud sync timestamps
      text[table] += spaces + spaces + 'created_at: DataTypes.DATE,\n';
      text[table] += spaces + spaces + 'updated_at: DataTypes.DATE,\n';

      if (table === self.parent) {

        if (self.form.statusField.isEnabled) {
          text[table] += spaces + spaces + self.form.statusField.dataName + ': DataTypes.TEXT,\n';
        }

        text[table] += spaces + spaces + 'version: DataTypes.INTEGER,\n';
        text[table] += spaces + spaces + 'client_created_at: DataTypes.DATE,\n';
        text[table] += spaces + spaces + 'client_updated_at: DataTypes.DATE,\n';
        text[table] += spaces + spaces + 'created_by: DataTypes.TEXT,\n';
        text[table] += spaces + spaces + 'created_by_id: DataTypes.TEXT,\n';
        text[table] += spaces + spaces + 'updated_by: DataTypes.TEXT,\n';
        text[table] += spaces + spaces + 'updated_by_id: DataTypes.TEXT,\n';
        text[table] += spaces + spaces + 'form_id: DataTypes.TEXT,\n';
      }
      else {

        // Fulcrum Record ID
        text[table] += spaces + spaces + 'fulcrum_record_id: {\n';
        text[table] += spaces + spaces + spaces + 'type: DataTypes.STRING(100),\n';
        text[table] += spaces + spaces + spaces + 'comment: \'Fulcrum Record ID\',\n';
        text[table] += spaces + spaces + '},\n';
      }

      if (self.geoEnabled[table]) {
        text[table] += spaces + spaces + 'the_geom: \'geometry(Point,4326)\',\n';
        text[table] += spaces + spaces + 'latitude: DataTypes.DECIMAL,\n';
        text[table] += spaces + spaces + 'longitude: DataTypes.DECIMAL,\n';
        text[table] += spaces + spaces + 'altitude: DataTypes.DECIMAL,\n';
        text[table] += spaces + spaces + 'horizontal_accuracy: DataTypes.DECIMAL,\n';
        text[table] += spaces + spaces + 'vertical_accuracy: DataTypes.DECIMAL,\n';
        text[table] += spaces + spaces + 'created_location: DataTypes.JSON,\n';
        text[table] += spaces + spaces + 'updated_location: DataTypes.JSON,\n';

        if (table === self.parent) {
          text[table] += spaces + spaces + 'speed: DataTypes.DECIMAL,\n';
          text[table] += spaces + spaces + 'course: DataTypes.DECIMAL,\n';
        }
      }

      _.each(fields, function (field) {

        // NOTE: repeatables and 1:M record links are kept in the list of  fields
        // because they are used to configure relationships (further down)
        if (field.isRepeatableElement || (field.isRecordLinkElement && field.allowMultiple)) {
          return;
        }

        text[table] += addField(field, spaces);

        if (field.isChoiceElement && field.allowOther) {
          text[table] += addField(field, spaces, '_other');
        }

        if (field.isPhotoElement || field.isAudioElement || field.isVideoElement) {
          text[table] += addField(field, spaces, '_caption');
        }

        if (field.isSignatureElement) {
          text[table] += addField(field, spaces, '_timestamp');
        }
      });

      text[table] += spaces + '}';


      // begin options for sequelize.
      text[table] += ', {\n';

      text[table] += spaces + spaces + 'tableName: \'' + table + '\',\n';

      //conditionally add additional options to tag on to orm objects
      _.each(_.keys(self.options.additional), function (addl) {

        var v = self.options.additional[addl];

        if (typeof v === 'string') {
          v = '\'' + v + '\'';
        }

        text[table] += spaces + spaces + addl + ': ' + v + ',\n';
      });

      var relations = _.filter(self.tables[table], function (el) {
        return el.isRepeatableElement || (el.isRecordLinkElement && el.allowMultiple);
      });

      if (relations.length) {
        text[table] += spaces + spaces + 'classMethods: {\n';
        text[table] += spaces + spaces + spaces + 'associate: function (models) {\n'

        _.each(relations, function (related) {
          text[table] += spaces + spaces + spaces + spaces + capitalized + '.hasMany(models.' + related.dataName + ', {\n';
          text[table] += spaces + spaces + spaces + spaces + spaces + 'foreignKey: {\n';
          text[table] += spaces + spaces + spaces + spaces + spaces + spaces + 'name: \'fulcrum_parent_id\',\n';
          text[table] += spaces + spaces + spaces + spaces + spaces + '},\n';
          text[table] += spaces + spaces + spaces + spaces + spaces + 'onDelete: \'CASCADE\',\n';
          text[table] += spaces + spaces + spaces + spaces + '});\n';
        });

        text[table] += spaces + spaces + spaces + '},\n';
        text[table] += spaces + spaces + '},\n';
      }

      text[table] = text[table].trim();
      text[table] += '\n' + spaces + '});\n';

      text[table] += spaces + 'return ' + capitalized + ';\n';

      text[table] += '};\n';
      _callback(null);
    }, function () {

      // TODO: probably a bad idea to nest this in the callback here
      async.each(self.recordLinked, function (dataName, _callback) {

        var capitalized = _.capitalize(dataName);

        text[dataName] = 'module.exports = function(sequelize, DataTypes) {\n';
        text[dataName] += spaces + 'var ' + capitalized + ' = sequelize.define(\'' + dataName + '\', {\n';

        // Fulcrum ID (primary key)
        text[dataName] += spaces + spaces + 'fulcrum_id: {\n';
        text[dataName] += spaces + spaces + spaces + 'primaryKey: true,\n';
        text[dataName] += spaces + spaces + spaces + 'type: DataTypes.STRING(100),\n';
        text[dataName] += spaces + spaces + spaces + 'comment: \'Fulcrum ID\',\n';
        text[dataName] += spaces + spaces + '},\n';

        // Fulcrum Parent ID (primary key)
        text[dataName] += spaces + spaces + 'fulcrum_parent_id: {\n';
        text[dataName] += spaces + spaces + spaces + 'primaryKey: true,\n';
        text[dataName] += spaces + spaces + spaces + 'type: DataTypes.STRING(100),\n';
        text[dataName] += spaces + spaces + spaces + 'comment: \'Fulcrum Parent ID\',\n';
        text[dataName] += spaces + spaces + '},\n';

        // Fulcrum Record ID
        text[dataName] += spaces + spaces + 'fulcrum_record_id: {\n';
        text[dataName] += spaces + spaces + spaces + 'type: DataTypes.STRING(100),\n';
        text[dataName] += spaces + spaces + spaces + 'comment: \'Fulcrum Record ID\',\n';
        text[dataName] += spaces + spaces + '},\n';

        text[dataName] += spaces + '}, {\n';

        text[dataName] += spaces + spaces + 'tableName: \'' + dataName + '\',\n';

        //conditionally add additional options to tag on to orm objects
        _.each(_.keys(self.options.additional), function (addl) {

          var v = self.options.additional[addl];

          if (typeof v === 'string') {
            v = '\'' + v + '\'';
          }

          text[dataName] += spaces + spaces + addl + ': ' + v + ',\n';
        });

        text[dataName] = text[dataName].trim();
        text[dataName] += '\n' + spaces + '});\n';
        text[dataName] += spaces + 'return ' + capitalized + ';\n';
        text[dataName] += '};\n';

        _callback();
      }, function () {
        self.write(text, callback);
      });
    });

    /**
     * addField
     * @param {Object} field
     * @param {string} spaces
     * @param {string} suffix
     * @returns {string}
     */
    function addField (field, spaces, suffix) {

      var toAdd = '';
      toAdd += spaces + spaces + field.dataName + (suffix || '') + ': {\n';
      toAdd += spaces + spaces + spaces + 'type: DataTypes.TEXT,\n';

      var label = (field.label || '').trim().replace(/\'/, '\\\'');
      toAdd += spaces + spaces + spaces + 'comment: \'' + label + '\',\n';
      toAdd += spaces + spaces + '},\n';

      return toAdd;
    }
  });
};

AutoFulcrum.prototype.write = function (attributes, callback) {
  var self = this;
  var tables = _.keys(attributes);

  var dirPath = path.resolve(self.options.directory);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  async.each(tables, createFile, callback);

  function createFile (table, _callback) {
    fs.writeFile(path.resolve(path.join(self.options.directory, table + '.js')), attributes[table], _callback);
  }
};

module.exports = AutoFulcrum;
