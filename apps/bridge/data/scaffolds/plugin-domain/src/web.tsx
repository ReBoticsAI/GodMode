import type { GodModeWebPluginRegister } from "@godmode/plugin-api";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
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
            Domain data lives in plugin SQLite via openPluginDb. Wire pages and tools to that store.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => navigate("/__PLUGIN_ID__")}>
            Open __PLUGIN_NAME__
          </Button>
        </CardContent>
      </Card>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing here yet</EmptyTitle>
          <EmptyDescription>
            Seed Structure in tenant:install. Prefer tools backed by openPluginDb for domain CRUD.
            Do not ship decorative Buttons.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

export const registerWeb: GodModeWebPluginRegister = (api) => {
  api.pageKinds.register([{ kind: "__PLUGIN_ID__-welcome", component: WelcomePage }]);
};
