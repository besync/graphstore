const { camelize, pluralize, singularize } = require('inflection');

const fs = require('fs');
const path = require('path');

const INCLUDE_CONSTRUCTOR = true;

var tsTypes = {
    'Boolean': 'boolean',
    'Float': 'number',
    'String': 'string',
    'ID': 'string',
    'OrgId': 'string',
    'UserId': 'string',
    'Int': 'int',
    'Date': 'Date',
    'Time': 'Time',
    'Json': 'Json'
}

const SYSTEM_GENERATED_HEADER =
    `/* **********************************************************
 *               SYSTEM GENERATED FILE: DO NOT EDIT     
 * This file was system generated by firebase-schema-generator 
 * on ${new Date().toUTCString()} 
 * *********************************************************** */

`

var modelHeader = (entities) => {
    return `${SYSTEM_GENERATED_HEADER}
import { Model, Submodel, Status, Store, primary, foreign, resolver, jsonfield, observable } from '@besync/graphstore';
export { toJS, push, IEnhancedObservableArray } from '@besync/graphstore';

export interface Time extends Date {};
export type int = number;
`}

const storeFunctionsTemplate = (entity) => {
    var name = entity.name;

    var connectors =
        Object.keys(entity.connectors).map((connectorName) => {
            var connector = entity.connectors[connectorName];
            return `
    static get${connectorName}(${connector.args.join(', ')}): ${name}${connector.action == "getCollection" ? "[]" : ""} { return ${name}.${connector.action}({${connector.args.join(', ')}}, \`${connector.path}\`);}`
        }).join('');

    //  var constructorArgs = entity.fields.filter(field => field.primary).map(field => getFieldKey(field))

    //  var create = `static create(defaults: {${constructorArgs.map(f => f + ": string").join(', ')}, [extra: string]: any }) : ${name} { return new ${name}(defaults) }`;

    var byIdConnector = entity.connectors["byId"];

    var path = `
    static path({${byIdConnector.args.join(', ')}}): string { return \`${byIdConnector.path}\` }`;

    return `${connectors}${path}`
}


const storeTemplate = (entity) => {
    var name = entity.name;

    return `
export class ${name}Store extends Store {${storeFunctionsTemplate(entity)}
}`
}

const modelTemplate = (entity) => {
    var name = entity.name;

    var fields = entity.fields.map(function (field) {
        return fieldTemplate(field, name, ".");
    }).join('');

    var subclasses = entity.fields.filter((field) => field.type == "Json").map(function (field) {
        return innerClassTemplate(name, getSubName(field.name), field.json, 0);
    }).join('');

    var privatefields = entity.fields
        .filter(field => field.foreign)
        .map(field => `
    @resolver get ${field.name}(): ${field.type} { return ${field.type}Store.getbyId(this.${field.name}_id) }; `)
        .join('');

    var constructor = '';

    if (INCLUDE_CONSTRUCTOR) {
        /*    var privatefieldsassignment = entity.fields
                .filter(field => field.foreign)
                .map(field => getFieldKey(field))
                .map(fieldname => `
            this.${fieldname} = defaults.${fieldname};`)
                .join('');
    
            var resolverfieldsassignment = entity.fields
                .filter(field => "resolver" in field && field.resolver.get.args.length !== 1)
                .map(field => `
            this.${field.name} = ${field.type}.get${field.resolver.get.connector}(${field.resolver.get.args.join(", ")});`)
                .join('');*/

        var constructorArgs = entity.fields.filter(field => field.primary).map(field => getFieldKey(field));

        constructor = `
    constructor (defaults: {${constructorArgs.map(f => f + ": string").join(', ')}, [extra: string]: any }, ...args) { super(defaults, ...args); } `
    }

    var store = `
    protected static Store: typeof Store = ${name}Store;`;

    return `
export class ${name} extends Model 
{${privatefields}
${fields}
${store}
${constructor}

}
${subclasses}`
}

const innerClassTemplate = (parent, name, fields, padding) => {

    var innerFields = fields.map(function (field) {
        return fieldTemplate(field, parent + "." + name, "");
    }).join('');

    var subclasses = fields.filter((field) => field.type == "Json").map(function (field) {
        return innerClassTemplate(parent, name + getSubName(field.name), field.json, padding);
    }).join('');

    return `
${" ".repeat(padding)}export namespace ${parent} {
${" ".repeat(padding)}    export class ${name} extends Submodel
${" ".repeat(padding)}    {${innerFields}
${" ".repeat(padding)}    }
${" ".repeat(padding)}}
${" ".repeat(padding)}${subclasses}`
}

const enumTemplate = (entity) => {
    var name = entity.name;

    var fields = entity.fields.map(function (field) {
        return `
        ${field.source ? '"' + field.source + '"' : field.name} = "${field.source ? field.source : field.name}"`
    }).join();

    return `
export namespace enums {
    export enum ${name}
    {${fields}
    }
}
`
}

const fieldTemplate = (field, parent, separator) => {

    var name = /:/.test(field.name) ? '"' + field.name + '"' : field.name;
    if (name == "value") name = "item_value";
    if (!field.nonNull && !field.resolver) name = name + "?";
    if (field.foreign) name = "@foreign " + name + "_id";

    var value = tsTypes[field.type] || field.type;
    if (field.foreign) value = "string";

    if (field.resolver && field.resolver.get && field.resolver.get.args.length == 1) {
        name = `@resolver get ${name}()`;
    }

    else if (value == "Json") {
        name = "@observable @jsonfield " + name;
        //  name = "@jsonfield " + name;
        value = parent + separator + getSubName(field.name);
    } else {
        name = "@observable " + name;
    }

    if (field.primary) name = "@primary " + name;

    if (value.startsWith("Enum"))
        value = "enums." + value;


    if (field.listType) value = value + "[]"

    if (field.resolver && field.resolver.get && field.resolver.get.args.length == 1) {
        value = `${value} { return ${field.type}Store.get${field.resolver.get.connector}(this.id); }`
    }

    return `
    ${name}: ${value};`
}

function getSubName(name) {
    return "_" + singularize(camelize(name.replace(/:/g, '_')))
}

function getFieldKey(field) {
    return field.foreign ? field.name + "_id" : field.name;
}


module.exports.default = function exporter(filename, schema) {

    var model = modelHeader(schema) + `

/* **************************
 * STORES
 * ************************** */
    `
        + Object.keys(schema)
            .filter(key => !key.startsWith("Enum"))
            .map(function (key) {
                var entity = schema[key];
                return storeTemplate(entity);
            }).join('');

    model += `

/* **************************
* ROOT MODELS
* ************************** */
`
        + Object.keys(schema)
            .filter(key => !key.startsWith("Enum"))
            .filter(key => schema[key].fields[0].type !== "User")
            .filter(key => schema[key].fields[0].type !== "Org")
            .map(function (key) {
                var entity = schema[key];
                return modelTemplate(entity);
            }).join('');

    model += `

/* **************************
 * USER-BASED MODELS
 * ************************** */
    `
        + Object.keys(schema)
            .filter(key => !key.startsWith("Enum"))
            .filter(key => schema[key].fields[0].type == "User")
            .map(function (key) {
                var entity = schema[key];
                return modelTemplate(entity);
            }).join('');

    model += `

/* **************************
 * ORG-BASED MODELS
 * ************************** */
    `
        + Object.keys(schema)
            .filter(key => !key.startsWith("Enum"))
            .filter(key => schema[key].fields[0].type == "Org")
            .map(function (key) {
                var entity = schema[key];
                return modelTemplate(entity);
            }).join('');


    model += `
/* **************************
 * ENUMS
 * ************************** */
    `
        + Object.keys(schema)
            .filter(key => key.startsWith("Enum"))
            .map(function (key) {
                var entity = schema[key];
                return enumTemplate(entity);
            }).join('');

    model += `
/* **************************
 * EXPORTS
 * ************************** */
    
export const stores = { ${Object.keys(schema).map(key => key + "Store").filter(key => !key.startsWith("Enum")).join(', ')} };
export const models = { ${Object.keys(schema).filter(key => !key.startsWith("Enum")).join(', ')} };
`

    var rootDir = path.resolve(__dirname, '../')
    var targetDir = path.relative(rootDir, path.dirname(filename));

    // CREATE OUTPUT DIRECTORIES IF THEY DONT EXIST
    [targetDir].forEach(targetDir => targetDir.split(path.sep).reduce((parentDir, childDir) => {
        const curDir = path.resolve(parentDir, childDir);
        if (!fs.existsSync(curDir)) {
            fs.mkdirSync(curDir);
        }

        return curDir;
    }, rootDir));

    fs.writeFileSync(filename, model);

    console.log(Object.keys(schema).length + " entities written to <ProjectDir>" + path.sep + path.relative(rootDir, filename));
   
}