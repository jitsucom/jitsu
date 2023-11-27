# Transformations

At the moment data transformations can be defined via [mappings](https://jitsu.com/docs/configuration/schema-and-mappings)
and [table name templates](https://jitsu.com/docs/configuration/table-names-and-filters). However, this approach has a few flows:

 - Mapping rules are pretty hard to read / write and understand. Turing-complete language always works better in such cases
 - The same applies to table name expression. Go template language is pretty unusual
 - There's no way to map one event to multiple events.

To solve those problems we're going to introduce JavaScript transformations.

**JavaScript transformation** is a piece of JavaScript code (or file) that exports a certain function
with certain semantics. Check out:

 - [transformations.d.ts](./transformations/transformations.d.ts) a prototype for type definition
 - [example.js](./transformations/transformations.d.ts) example transformation file that implements [Segment Compatibility](https://jitsu.com/docs/other-features/segment-compatibility)


## Transformations SDK

We need to create two npm packages: for creating transformation project and for running

### Create a transformation project

`npx create-jitsu-transform jitsu-test` / `yarn create jitsu-transform jitsu-test` / `npm init jitsu-transform jitsu-test` should
create a new project with transformation. The project should:
 - Compile code to a single JS file
 - Have `jitsu-trasform/types` as a dependency

### Test

`npx jitsu-trasform` should help users to test transformation logic with a simple command-line tools

#### Parameters:
 - `-f, --file <file>` input file. If not set, data will be read from stdout
 - `-s, --server <url>` and [URL of Jitsu Server event cache](https://jitsu.com/docs/other-features/events-cache). In this case events will
be taken from a realtime cache.
 - `-a, --auth <file>` input file. If not set, data will be read from stdout
 - `-d, --data ` to specify JSON object as string
 - `-j, --json-format <json|ndjson>, default - json` how input data shall be treated. As JSON (we need support both arrays and obejcts or [ndjson (Newline Delimited JSON)](http://ndjson.org/))
 - `-o, --output <file>` output file. If not set, result will be prented to STDOUT
 - `-p, --pretty` if result should be pretty-printed
 - `-t, --transformation <file>` js file with transformation function
 - `-e, --eval` same as file, but specify content as string

Also, the package should export type (see prototype [transformations.d.ts](./transformations/transformations.d.ts)) to simplify development and static
analysis


## Configuration of transformations

First we need to keep current way of configuring transformations intact. We have some legacy installations where this way can be in use.

However, a new way of configuring transformations should be introduced. The idea is to separate transformations from sources and destinations
and move them to a separate section (on a same level as `sources` and `destinations`). Example:

```yaml
transformations:
# either sources or API keys must be present
  sources: '*'
  api_keys: ['a', 'b']
#should be present. Both '*' and list should be supported
  destinations: '*'
# either file or code should be present
  file: 'path'
  code: 'event.x = 1; delete event.y'
# if module exports several function, see multiExports.js as an example
  function: transform1
#
```

## Transformation code format

We can't expect that our users are fluent in node/js environment coding, so we need to expect the code
to be in different formats. The common use-cases can be found at `imports/` directory. A brief explanation of use-cases:
 - `code.js` — as few code lines as possible. The syntax useful for embedding the logic
 - `exportDefault.js` - the function is exported as default, without a name
 - `multiExport.js` - the module exports a few functions. Useful when different transformations should be applied to a different
part sources / destinations
 - `root.js` function with name transform is defined but not exported
 - `singleExport` same as root.js, but function is properly exported

Also, the function can return different types of data. All of them should be treated properly. The logic is described in comments of
[transformations.d.ts](./transformations/transformations.d.ts)




