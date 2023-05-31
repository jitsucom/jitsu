/**
 * This api route is used to test error handling
 */

import { NextApiHandler } from "next/types";

const handler: NextApiHandler = async (req, res) => {
  throw new Error("This is an error");
};

export default handler;
