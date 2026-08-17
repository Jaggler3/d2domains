import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Key, Server } from "lucide-react";

interface EmailStarterCardProps {
  domainName: string;
  emailData: {
    address: string;
    password: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
  } | null;
}

export function EmailStarterCard({ domainName, emailData }: EmailStarterCardProps) {
  if (!emailData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Starter
          </CardTitle>
          <CardDescription>
            Email provisioning is not available or pending for this domain.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Starter
        </CardTitle>
        <CardDescription>
          Your professional mailbox is ready. Use these details to connect your email client.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg border">
          <div className="flex items-center gap-3">
            <Server className="h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-xs font-medium uppercase text-muted-foreground">Email Address</span>
              <span className="font-mono text-sm">{emailData.address}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg border">
          <div className="flex items-center gap-3">
            <Key className="h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-xs font-medium uppercase text-muted-foreground">Password</span>
              <span className="font-mono text-sm">{emailData.password}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-muted rounded-lg border">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase text-muted-foreground">IMAP (Incoming)</span>
              <span className="font-mono text-xs">{emailData.imapHost}:{emailData.imapPort}</span>
            </div>
          </div>
          <div className="p-3 bg-muted rounded-lg border">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase text-muted-foreground">SMTP (Outgoing)</span>
              <span className="font-mono text-xs">{emailData.smtpHost}:{emailData.smtpPort}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
