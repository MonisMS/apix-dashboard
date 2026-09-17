/**
 * Tabler-icon names used by the existing pages, re-exported as lucide-react
 * icons (the icon set shadcn/ui assumes) with the same size/stroke API shape.
 */
import {
  AlertTriangle, Calculator, ChartArea, ChartBar, Check, CheckCircle2, Clock,
  CloudDownload, EyeOff, Filter, Grid3x3, Info, PlaneTakeoff, Receipt,
  ReceiptText, Route, Scale, Server, Target, X,
} from 'lucide-react';

function wrap(Icon) {
  return function Wrapped({ size = 16, stroke, color, className, ...rest }) {
    return <Icon size={size} color={color} className={className} strokeWidth={stroke ? stroke * 1.2 : 2} {...rest} />;
  };
}

export const IconAlertTriangle = wrap(AlertTriangle);
export const IconCalculator = wrap(Calculator);
export const IconChartAreaLine = wrap(ChartArea);
export const IconChartHistogram = wrap(ChartBar);
export const IconCheck = wrap(Check);
export const IconCircleCheck = wrap(CheckCircle2);
export const IconClock = wrap(Clock);
export const IconCloudDownload = wrap(CloudDownload);
export const IconEyeOff = wrap(EyeOff);
export const IconFilter = wrap(Filter);
export const IconGridDots = wrap(Grid3x3);
export const IconInfoCircle = wrap(Info);
export const IconPlaneTilt = wrap(PlaneTakeoff);
export const IconReceipt2 = wrap(Receipt);
export const IconReceiptTax = wrap(ReceiptText);
export const IconRoute = wrap(Route);
export const IconScale = wrap(Scale);
export const IconServer2 = wrap(Server);
export const IconTargetArrow = wrap(Target);
export const IconX = wrap(X);
