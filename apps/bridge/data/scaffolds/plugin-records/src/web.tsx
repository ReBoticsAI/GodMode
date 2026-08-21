import type { GodModeWebPluginRegister } from "@godmode/plugin-api";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from "@godmode/web-host";

function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className={cn("mx-auto flex max-w-lg flex-col gap-6 p-6")}>
      <Card>
        <CardHeader>
          <CardTitle>__PLUGIN_NAME__</CardTitle>
          <CardDescription>
            Core Records path: list/edit via host record-list. Not for plugin-owned business SQLite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => navigate("/__PLUGIN_ID__-list")}>
            Open items
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export const registerWeb: GodModeWebPluginRegister = (api) => {
  api.pageKinds.register([{ kind: "__PLUGIN_ID__-welcome", component: WelcomePage }]);
};
