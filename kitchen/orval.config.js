module.exports = {
  api: {
    input: "../shared/openapi.json",
    output: {
      mode: "tags-split",
      target: "src/api/generated",
      client: "axios",
      override: {
        mutator: {
          path: "./src/api/axios-instance.ts",
          name: "customInstance",
        },
      },
    },
  },
};
