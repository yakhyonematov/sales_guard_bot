import { Context, Scenes } from 'telegraf';
import { User, UserRole, Rop, Manager } from '@prisma/client';

export interface UserWithProfiles extends User {
  ropProfile?: Rop | null;
  managerProfile?: Manager | null;
}

export interface SessionData extends Scenes.WizardSession<Scenes.WizardSessionData> {
  // Wizard & Flow temporary state
  violationDraft?: {
    managerId?: string;
    managerName?: string;
    ropName?: string;
    clauseId?: string;
    clauseCode?: string;
    clauseText?: string;
    scaleName?: string;
    comment?: string;
    attachmentFileId?: string;
    idempotencyKey?: string;
    predictedOccurrence?: number;
    predictedType?: 'AMOUNT' | 'FACT';
    predictedAmount?: number;
  };
  registrationDraft?: {
    ropId?: string;
    step?: 'ENTER_NAME';
  };
  filterMonth?: string;
  reportDraft?: {
    step?: string;
    name?: string;
    groupBy?: string;
    metric?: string;
    periodType?: string;
  };
  scaleEditDraft?: {
    scaleId?: string;
    tierIndex?: number;
  };
  managerFilterRopId?: string;
  managerSearchQuery?: string;
  managerPage?: number;
  historyPage?: number;

  // ROP & Manager Admin Flows
  ropDraft?: {
    step?: 'ENTER_NAME' | 'ENTER_TG_ID';
    fullName?: string;
    ropId?: string;
  };
  managerDraft?: {
    step?: 'ENTER_NAME' | 'SELECT_ROP';
    fullName?: string;
    ropId?: string;
  };
  ropAssignDraft?: {
    ropId: string;
    ropName?: string;
    searchQuery?: string;
    page: number;
    waitingForSearch?: boolean;
  };
  managerListDraft?: {
    page: number;
    searchQuery?: string;
    waitingForSearch?: boolean;
    ropId?: string;
  };
}

export interface BotContext extends Scenes.WizardContext {
  session: SessionData;
  dbUser?: UserWithProfiles | null;
  match?: RegExpMatchArray;
}
