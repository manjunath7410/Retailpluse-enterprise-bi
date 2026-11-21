import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdvancedModuleId } from '../types/analytics';
import { DataStateBanner } from '../components/ui/DataStateBanner';
import { AdvancedAnalyticsWorkspace } from '../components/ui/AdvancedAnalyticsWorkspace';

const VALID_MODELS = new Set<AdvancedModuleId>([
  'rfm-segmentation',
  'cohort-retention',
  'delivery-satisfaction',
  'seller-performance',
  'business-opportunities',
  'sales-forecasting'
]);

interface AdvancedModelsPageProps {
  defaultModule?: AdvancedModuleId;
}

export const AdvancedModelsPage: React.FC<AdvancedModelsPageProps> = ({
  defaultModule = 'rfm-segmentation'
}) => {
  const [searchParams] = useSearchParams();
  const queryModel = searchParams.get('model') as AdvancedModuleId | null;
  const activeModel: AdvancedModuleId =
    queryModel && VALID_MODELS.has(queryModel) ? queryModel : defaultModule;

  return (
    <div className="space-y-5">
      <DataStateBanner />
      <AdvancedAnalyticsWorkspace defaultModule={activeModel} compactHeader={false} />
    </div>
  );
};
