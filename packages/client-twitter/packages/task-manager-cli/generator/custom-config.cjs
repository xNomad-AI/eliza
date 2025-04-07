// custom-config.js
module.exports = {
  hooks: {
    onPreParseSchema: (schema, typeName, schemaType) => {
      // change hidden type to any type
      if (schema.type === 'hidden' || schema?.schema?.type === 'hidden') {
        return { ...schema, type: 'any' };
      }
      // if (schema['$ref']) console.log(schema)
      // if (schema['description'] === 'An array of OHLCV quotes for the supplied interval.') {
      //   console.log(schema)
      //   console.log(typeName)
      //   console.log(schemaType)
      // }

      // // if (schema['description'] === 'A map of market quotes in different currency conversions. The default map included is USD.') {
      // //   console.log(schema)
      // //   console.log(typeName)
      // //   console.log(schemaType)
      // // }
    },
    // return formattedName can change interface name
    onFormatTypeName: (formattedName, name, schemaType) => {
    }
  },
};