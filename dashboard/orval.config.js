module.exports = {
  api: {
    input: '../shared/openapi.json',
    output: {
      mode: 'tags-split',
      target: 'src/api/generated',
      client: 'axios',
      override: {
        mutator: {
          path: './src/services/api.ts',
          name: 'customInstance',
        },
      },
    },
  },
};
