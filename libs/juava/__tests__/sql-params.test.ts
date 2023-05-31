import { namedParameters, unrollParams } from "../src";

test("named-parameters and unroll", () => {
  const sql =
    "SELECT * FROM users WHERE id = :id AND secondId = :id AND name = :name AND age = :age AND thirdId=:id OR otherParam=:ne ORDER BY id";
  const params = {
    ne: "ne",
    id: 1,
    name: "John",
    age: 30,
  };

  const result = namedParameters(sql, params);
  console.log(result);
  expect(result.query).toBe(
    "SELECT * FROM users WHERE id = $1 AND secondId = $1 AND name = $2 AND age = $3 AND thirdId=$1 OR otherParam=$4 ORDER BY id"
  );
  expect(result.values).toEqual([1, "John", 30, "ne"]);
  const unrolled = unrollParams(result.query, result.values);
  expect(unrolled).toBe(
    `SELECT * FROM users WHERE id = 1 AND secondId = 1 AND name = 'John' AND age = 30 AND thirdId=1 OR otherParam='ne' ORDER BY id`
  );
});
