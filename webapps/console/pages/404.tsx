import { useRouter } from "next/router";
import { Button } from "antd";

export default function Custom404() {
  const router = useRouter();
  return (
    <div className="flex items-center flex-col pt-12">
      <div className="w-1/2 max-w-4xl text-xl">
        <h1 className="text-center uppercase text-textLight">Error 404 </h1>
        <h2 className="text-3xl font-bold text-center mb-6 ">The page does not exist</h2>
        <h3 className="text-xl text-textLight text-center mt-12">
          URL: <code>{window.location.pathname}</code>
        </h3>
        <div className="flex justify-center mt-12">
          <Button className="mx-auto" size="large" type="primary" href="/">
            Go to home page
          </Button>
        </div>
      </div>
    </div>
  );
}
