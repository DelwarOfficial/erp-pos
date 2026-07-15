-- prisma/migrations/0015_m6_crm_hr_tables.sql
-- §5.6A CRM (Leads, Activities, Sources, Statuses, Subjects)
-- §5.13 HR (Departments, Designations, Employees, Payroll, Holidays, Leave, Attendance)
-- §5.14 Notifications + Communication Consents/Campaigns
-- §5.14A Data Subject Requests (GDPR/PDPA)

BEGIN;


-- ============================================================================
-- TABLES (21 tables)
-- ============================================================================

-- ============================================================================
-- lead_subjects
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_subjects (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_lead_subjects_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_lead_subjects_company_id_name UNIQUE (company_id, name)
);


-- ============================================================================
-- lead_sources
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_sources (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_lead_sources_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_lead_sources_company_id_name UNIQUE (company_id, name)
);


-- ============================================================================
-- lead_statuses
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_statuses (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  position INTEGER NOT NULL,
  is_won BOOLEAN DEFAULT false NOT NULL,
  is_lost BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_lead_statuses_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_lead_statuses_company_id_name UNIQUE (company_id, name),
  CONSTRAINT uq_lead_statuses_company_id_position UNIQUE (company_id, position)
);


-- ============================================================================
-- leads
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID,
  subject_id UUID,
  source_id UUID,
  status_id UUID NOT NULL,
  assigned_to UUID,
  name VARCHAR NOT NULL,
  company_name VARCHAR,
  phone VARCHAR,
  email VARCHAR,
  estimated_value DECIMAL(18,2),
  next_action_at TIMESTAMPTZ,
  notes VARCHAR,
  converted_customer_id UUID,
  converted_quotation_id UUID,
  lost_reason VARCHAR,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_leads_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_subject_id FOREIGN KEY (subject_id) REFERENCES lead_subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_source_id FOREIGN KEY (source_id) REFERENCES lead_sources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_status_id FOREIGN KEY (status_id) REFERENCES lead_statuses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_converted_customer_id FOREIGN KEY (converted_customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_leads_converted_customer_id UNIQUE (converted_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_company_id ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_status_id ON leads(status_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_next_action_at ON leads(next_action_at);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- lead_activities
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_activities (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  activity_type VARCHAR NOT NULL,
  summary VARCHAR NOT NULL,
  details VARCHAR,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_lead_activities_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lead_activities_lead_id FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lead_activities_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_company_id ON lead_activities(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_activity_type ON lead_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_lead_activities_scheduled_at ON lead_activities(scheduled_at);

-- ============================================================================
-- departments
-- ============================================================================
CREATE TABLE IF NOT EXISTS departments (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  manager_employee_id UUID,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_departments_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_departments_company_id_name UNIQUE (company_id, name)
);


-- ============================================================================
-- designations
-- ============================================================================
CREATE TABLE IF NOT EXISTS designations (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_designations_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_designations_company_id_name UNIQUE (company_id, name)
);


-- ============================================================================
-- employees
-- ============================================================================
CREATE TABLE IF NOT EXISTS employees (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  user_id UUID,
  employee_no VARCHAR NOT NULL,
  branch_id UUID NOT NULL,
  department_id UUID,
  designation_id UUID,
  name VARCHAR NOT NULL,
  phone VARCHAR,
  email VARCHAR,
  address VARCHAR,
  join_date TIMESTAMPTZ NOT NULL,
  employment_status VARCHAR DEFAULT 'active' NOT NULL CHECK (employment_status IN ('active','on_leave','terminated')),
  base_salary DECIMAL(18,2) DEFAULT 0 NOT NULL,
  payroll_expense_account_id UUID NOT NULL,
  payroll_payable_account_id UUID NOT NULL,
  terminated_at TIMESTAMPTZ,
  CONSTRAINT fk_employees_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_department_id FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_designation_id FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE RESTRICT,
  CONSTRAINT uq_employees_company_id_employee_no UNIQUE (company_id, employee_no),
  CONSTRAINT uq_employees_user_id UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch_id ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_employment_status ON employees(employment_status);

-- ============================================================================
-- payroll_components
-- ============================================================================
CREATE TABLE IF NOT EXISTS payroll_components (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  code VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  component_type VARCHAR DEFAULT 'earning' NOT NULL CHECK (component_type IN ('earning','deduction','employer_cost','withholding')),
  calculation_type VARCHAR DEFAULT 'fixed' NOT NULL CHECK (calculation_type IN ('fixed','percentage','formula','manual')),
  default_value DECIMAL(18,2) DEFAULT 0 NOT NULL,
  account_id UUID NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_payroll_components_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_components_account_id FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT uq_payroll_components_company_id_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_payroll_components_company_id ON payroll_components(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_components_component_type ON payroll_components(component_type);

-- ============================================================================
-- payroll_runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS payroll_runs (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID,
  reference_no VARCHAR NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','approved','posted','paid','reversed')),
  gross_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  deduction_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  net_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  approved_by UUID,
  posted_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_payroll_runs_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_runs_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_runs_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_runs_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_payroll_runs_company_id_reference_no UNIQUE (company_id, reference_no)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_id ON payroll_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs(status);

-- ============================================================================
-- payroll_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS payroll_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  payroll_run_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  base_salary DECIMAL(18,2) NOT NULL,
  allowance_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  overtime_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  deduction_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  withholding_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  net_pay DECIMAL(18,2) NOT NULL,
  calculation_detail VARCHAR DEFAULT '{}' NOT NULL,
  CONSTRAINT fk_payroll_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_items_payroll_run_id FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_items_employee_id FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  CONSTRAINT uq_payroll_items_payroll_run_id_employee_id UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_company_id ON payroll_items(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_payroll_run_id ON payroll_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_employee_id ON payroll_items(employee_id);

-- ============================================================================
-- payroll_item_components
-- ============================================================================
CREATE TABLE IF NOT EXISTS payroll_item_components (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  payroll_item_id UUID NOT NULL,
  payroll_component_id UUID NOT NULL,
  amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  calculation_basis VARCHAR DEFAULT '{}' NOT NULL,
  CONSTRAINT fk_payroll_item_components_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_item_components_payroll_component_id FOREIGN KEY (payroll_component_id) REFERENCES payroll_components(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_item_components_payroll_item_id FOREIGN KEY (payroll_item_id) REFERENCES payroll_items(id) ON DELETE RESTRICT,
  CONSTRAINT uq_payroll_item_components_9213 UNIQUE (payroll_item_id, payroll_component_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_item_components_company_id ON payroll_item_components(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_item_components_payroll_item_id ON payroll_item_components(payroll_item_id);

-- ============================================================================
-- holidays
-- ============================================================================
CREATE TABLE IF NOT EXISTS holidays (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID,
  title VARCHAR NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  is_paid BOOLEAN DEFAULT true NOT NULL,
  notes VARCHAR,
  CONSTRAINT fk_holidays_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_holidays_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_holidays_company_id ON holidays(company_id);
CREATE INDEX IF NOT EXISTS idx_holidays_branch_id ON holidays(branch_id);
CREATE INDEX IF NOT EXISTS idx_holidays_start_date ON holidays(start_date);

-- ============================================================================
-- leave_types
-- ============================================================================
CREATE TABLE IF NOT EXISTS leave_types (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  annual_allowance_days DECIMAL(18,2),
  is_paid BOOLEAN DEFAULT true NOT NULL,
  requires_attachment BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_leave_types_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_leave_types_company_id_name UNIQUE (company_id, name)
);


-- ============================================================================
-- leave_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS leave_requests (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  leave_type_id UUID NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  requested_days DECIMAL(18,2) NOT NULL,
  status VARCHAR DEFAULT 'pending' NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason VARCHAR NOT NULL,
  approval_request_id UUID,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_leave_requests_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leave_requests_employee_id FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leave_requests_leave_type_id FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_company_id ON leave_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_id ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_start_date ON leave_requests(start_date);

-- ============================================================================
-- attendance_records
-- ============================================================================
CREATE TABLE IF NOT EXISTS attendance_records (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  work_date TIMESTAMPTZ NOT NULL,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  status VARCHAR DEFAULT 'present' NOT NULL CHECK (status IN ('present','absent','leave','holiday')),
  approved_by UUID,
  CONSTRAINT fk_attendance_records_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_records_employee_id FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  CONSTRAINT uq_attendance_records_employee_id_work_date UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_company_id ON attendance_records(company_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_id ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status ON attendance_records(status);

-- ============================================================================
-- notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  notification_type VARCHAR NOT NULL,
  severity VARCHAR DEFAULT 'info' NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  title VARCHAR NOT NULL,
  body VARCHAR NOT NULL,
  action_url VARCHAR,
  entity_type VARCHAR,
  entity_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_notifications_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_notifications_company_id ON notifications(company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_severity ON notifications(severity);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at);

-- ============================================================================
-- communication_consents
-- ============================================================================
CREATE TABLE IF NOT EXISTS communication_consents (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  customer_id UUID,
  supplier_id UUID,
  channel VARCHAR DEFAULT 'sms' NOT NULL CHECK (channel IN ('sms','email','push','whatsapp')),
  purpose VARCHAR DEFAULT 'transactional' NOT NULL CHECK (purpose IN ('transactional','marketing')),
  consent_status VARCHAR DEFAULT 'not_required' NOT NULL CHECK (consent_status IN ('granted','withdrawn','not_required')),
  source VARCHAR NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  captured_by VARCHAR,
  CONSTRAINT fk_communication_consents_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_consents_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_consents_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_communication_consents_company_id ON communication_consents(company_id);
CREATE INDEX IF NOT EXISTS idx_communication_consents_customer_id ON communication_consents(customer_id);
CREATE INDEX IF NOT EXISTS idx_communication_consents_supplier_id ON communication_consents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_communication_consents_consent_status ON communication_consents(consent_status);

-- ============================================================================
-- communication_campaigns
-- ============================================================================
CREATE TABLE IF NOT EXISTS communication_campaigns (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  channel VARCHAR DEFAULT 'sms' NOT NULL CHECK (channel IN ('sms','email','push','whatsapp')),
  template_id UUID NOT NULL,
  audience_definition VARCHAR DEFAULT '{}' NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','scheduled','running','completed','cancelled','failed')),
  scheduled_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_communication_campaigns_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_campaigns_template_id FOREIGN KEY (template_id) REFERENCES communication_templates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_campaigns_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_campaigns_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_communication_campaigns_company_id ON communication_campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_communication_campaigns_status ON communication_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_communication_campaigns_scheduled_at ON communication_campaigns(scheduled_at);

-- ============================================================================
-- communication_campaign_recipients
-- ============================================================================
CREATE TABLE IF NOT EXISTS communication_campaign_recipients (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  recipient_type VARCHAR DEFAULT 'customer' NOT NULL CHECK (recipient_type IN ('customer','supplier','manual')),
  customer_id UUID,
  supplier_id UUID,
  destination VARCHAR NOT NULL,
  consent_snapshot VARCHAR DEFAULT 'not_required' NOT NULL,
  status VARCHAR DEFAULT 'queued' NOT NULL CHECK (status IN ('queued','sent','delivered','failed','skipped')),
  skip_reason VARCHAR,
  CONSTRAINT fk_communication_campaign_recipients_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_campaign_recipients_campaign_id FOREIGN KEY (campaign_id) REFERENCES communication_campaigns(id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_campaign_recipients_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT uq_communication_campaign_recipients_campaign_id_destination UNIQUE (campaign_id, destination)
);

CREATE INDEX IF NOT EXISTS idx_communication_campaign_recipients_company_id ON communication_campaign_recipients(company_id);
CREATE INDEX IF NOT EXISTS idx_communication_campaign_recipients_campaign_id ON communication_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_communication_campaign_recipients_status ON communication_campaign_recipients(status);

-- ============================================================================
-- data_subject_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS data_subject_requests (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  request_type VARCHAR NOT NULL CHECK (request_type IN ('access','rectification','erasure','portability','objection')),
  customer_id UUID,
  supplier_id UUID,
  status VARCHAR DEFAULT 'open' NOT NULL CHECK (status IN ('open','in_progress','completed','rejected')),
  details VARCHAR,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_data_subject_requests_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_data_subject_requests_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_data_subject_requests_company_id ON data_subject_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_data_subject_requests_request_type ON data_subject_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_data_subject_requests_status ON data_subject_requests(status);


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- RLS for lead_subjects
ALTER TABLE lead_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_subjects FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'lead_subjects_tenant_read' AND tablename = 'lead_subjects') THEN
    EXECUTE 'CREATE POLICY lead_subjects_tenant_read ON lead_subjects FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'lead_subjects_tenant_write' AND tablename = 'lead_subjects') THEN
    EXECUTE 'CREATE POLICY lead_subjects_tenant_write ON lead_subjects FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON lead_subjects TO app_role;
GRANT SELECT ON lead_subjects TO backup_role;
GRANT SELECT ON lead_subjects TO reporting_role;

-- RLS for lead_sources
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'lead_sources_tenant_read' AND tablename = 'lead_sources') THEN
    EXECUTE 'CREATE POLICY lead_sources_tenant_read ON lead_sources FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'lead_sources_tenant_write' AND tablename = 'lead_sources') THEN
    EXECUTE 'CREATE POLICY lead_sources_tenant_write ON lead_sources FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON lead_sources TO app_role;
GRANT SELECT ON lead_sources TO backup_role;
GRANT SELECT ON lead_sources TO reporting_role;

-- RLS for lead_statuses
ALTER TABLE lead_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_statuses FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'lead_statuses_tenant_read' AND tablename = 'lead_statuses') THEN
    EXECUTE 'CREATE POLICY lead_statuses_tenant_read ON lead_statuses FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'lead_statuses_tenant_write' AND tablename = 'lead_statuses') THEN
    EXECUTE 'CREATE POLICY lead_statuses_tenant_write ON lead_statuses FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON lead_statuses TO app_role;
GRANT SELECT ON lead_statuses TO backup_role;
GRANT SELECT ON lead_statuses TO reporting_role;

-- RLS for leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'leads_tenant_read' AND tablename = 'leads') THEN
    EXECUTE 'CREATE POLICY leads_tenant_read ON leads FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'leads_tenant_write' AND tablename = 'leads') THEN
    EXECUTE 'CREATE POLICY leads_tenant_write ON leads FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON leads TO app_role;
GRANT SELECT ON leads TO backup_role;
GRANT SELECT ON leads TO reporting_role;

-- RLS for lead_activities
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'lead_activities_tenant_read' AND tablename = 'lead_activities') THEN
    EXECUTE 'CREATE POLICY lead_activities_tenant_read ON lead_activities FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'lead_activities_tenant_write' AND tablename = 'lead_activities') THEN
    EXECUTE 'CREATE POLICY lead_activities_tenant_write ON lead_activities FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON lead_activities TO app_role;
GRANT SELECT ON lead_activities TO backup_role;
GRANT SELECT ON lead_activities TO reporting_role;

-- RLS for departments
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'departments_tenant_read' AND tablename = 'departments') THEN
    EXECUTE 'CREATE POLICY departments_tenant_read ON departments FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'departments_tenant_write' AND tablename = 'departments') THEN
    EXECUTE 'CREATE POLICY departments_tenant_write ON departments FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO app_role;
GRANT SELECT ON departments TO backup_role;
GRANT SELECT ON departments TO reporting_role;

-- RLS for designations
ALTER TABLE designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE designations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'designations_tenant_read' AND tablename = 'designations') THEN
    EXECUTE 'CREATE POLICY designations_tenant_read ON designations FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'designations_tenant_write' AND tablename = 'designations') THEN
    EXECUTE 'CREATE POLICY designations_tenant_write ON designations FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON designations TO app_role;
GRANT SELECT ON designations TO backup_role;
GRANT SELECT ON designations TO reporting_role;

-- RLS for employees
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'employees_tenant_read' AND tablename = 'employees') THEN
    EXECUTE 'CREATE POLICY employees_tenant_read ON employees FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'employees_tenant_write' AND tablename = 'employees') THEN
    EXECUTE 'CREATE POLICY employees_tenant_write ON employees FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO app_role;
GRANT SELECT ON employees TO backup_role;
GRANT SELECT ON employees TO reporting_role;

-- RLS for payroll_components
ALTER TABLE payroll_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_components FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payroll_components_tenant_read' AND tablename = 'payroll_components') THEN
    EXECUTE 'CREATE POLICY payroll_components_tenant_read ON payroll_components FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payroll_components_tenant_write' AND tablename = 'payroll_components') THEN
    EXECUTE 'CREATE POLICY payroll_components_tenant_write ON payroll_components FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_components TO app_role;
GRANT SELECT ON payroll_components TO backup_role;
GRANT SELECT ON payroll_components TO reporting_role;

-- RLS for payroll_runs
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payroll_runs_tenant_read' AND tablename = 'payroll_runs') THEN
    EXECUTE 'CREATE POLICY payroll_runs_tenant_read ON payroll_runs FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payroll_runs_tenant_write' AND tablename = 'payroll_runs') THEN
    EXECUTE 'CREATE POLICY payroll_runs_tenant_write ON payroll_runs FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs TO app_role;
GRANT SELECT ON payroll_runs TO backup_role;
GRANT SELECT ON payroll_runs TO reporting_role;

-- RLS for payroll_items
ALTER TABLE payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payroll_items_tenant_read' AND tablename = 'payroll_items') THEN
    EXECUTE 'CREATE POLICY payroll_items_tenant_read ON payroll_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payroll_items_tenant_write' AND tablename = 'payroll_items') THEN
    EXECUTE 'CREATE POLICY payroll_items_tenant_write ON payroll_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_items TO app_role;
GRANT SELECT ON payroll_items TO backup_role;
GRANT SELECT ON payroll_items TO reporting_role;

-- RLS for payroll_item_components
ALTER TABLE payroll_item_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_item_components FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payroll_item_components_tenant_read' AND tablename = 'payroll_item_components') THEN
    EXECUTE 'CREATE POLICY payroll_item_components_tenant_read ON payroll_item_components FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payroll_item_components_tenant_write' AND tablename = 'payroll_item_components') THEN
    EXECUTE 'CREATE POLICY payroll_item_components_tenant_write ON payroll_item_components FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_item_components TO app_role;
GRANT SELECT ON payroll_item_components TO backup_role;
GRANT SELECT ON payroll_item_components TO reporting_role;

-- RLS for holidays
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'holidays_tenant_read' AND tablename = 'holidays') THEN
    EXECUTE 'CREATE POLICY holidays_tenant_read ON holidays FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'holidays_tenant_write' AND tablename = 'holidays') THEN
    EXECUTE 'CREATE POLICY holidays_tenant_write ON holidays FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON holidays TO app_role;
GRANT SELECT ON holidays TO backup_role;
GRANT SELECT ON holidays TO reporting_role;

-- RLS for leave_types
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'leave_types_tenant_read' AND tablename = 'leave_types') THEN
    EXECUTE 'CREATE POLICY leave_types_tenant_read ON leave_types FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'leave_types_tenant_write' AND tablename = 'leave_types') THEN
    EXECUTE 'CREATE POLICY leave_types_tenant_write ON leave_types FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON leave_types TO app_role;
GRANT SELECT ON leave_types TO backup_role;
GRANT SELECT ON leave_types TO reporting_role;

-- RLS for leave_requests
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'leave_requests_tenant_read' AND tablename = 'leave_requests') THEN
    EXECUTE 'CREATE POLICY leave_requests_tenant_read ON leave_requests FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'leave_requests_tenant_write' AND tablename = 'leave_requests') THEN
    EXECUTE 'CREATE POLICY leave_requests_tenant_write ON leave_requests FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON leave_requests TO app_role;
GRANT SELECT ON leave_requests TO backup_role;
GRANT SELECT ON leave_requests TO reporting_role;

-- RLS for attendance_records
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'attendance_records_tenant_read' AND tablename = 'attendance_records') THEN
    EXECUTE 'CREATE POLICY attendance_records_tenant_read ON attendance_records FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'attendance_records_tenant_write' AND tablename = 'attendance_records') THEN
    EXECUTE 'CREATE POLICY attendance_records_tenant_write ON attendance_records FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_records TO app_role;
GRANT SELECT ON attendance_records TO backup_role;
GRANT SELECT ON attendance_records TO reporting_role;

-- RLS for notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_tenant_read' AND tablename = 'notifications') THEN
    EXECUTE 'CREATE POLICY notifications_tenant_read ON notifications FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_tenant_write' AND tablename = 'notifications') THEN
    EXECUTE 'CREATE POLICY notifications_tenant_write ON notifications FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO app_role;
GRANT SELECT ON notifications TO backup_role;
GRANT SELECT ON notifications TO reporting_role;

-- RLS for communication_consents
ALTER TABLE communication_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_consents FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'communication_consents_tenant_read' AND tablename = 'communication_consents') THEN
    EXECUTE 'CREATE POLICY communication_consents_tenant_read ON communication_consents FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'communication_consents_tenant_write' AND tablename = 'communication_consents') THEN
    EXECUTE 'CREATE POLICY communication_consents_tenant_write ON communication_consents FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON communication_consents TO app_role;
GRANT SELECT ON communication_consents TO backup_role;
GRANT SELECT ON communication_consents TO reporting_role;

-- RLS for communication_campaigns
ALTER TABLE communication_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_campaigns FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'communication_campaigns_tenant_read' AND tablename = 'communication_campaigns') THEN
    EXECUTE 'CREATE POLICY communication_campaigns_tenant_read ON communication_campaigns FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'communication_campaigns_tenant_write' AND tablename = 'communication_campaigns') THEN
    EXECUTE 'CREATE POLICY communication_campaigns_tenant_write ON communication_campaigns FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON communication_campaigns TO app_role;
GRANT SELECT ON communication_campaigns TO backup_role;
GRANT SELECT ON communication_campaigns TO reporting_role;

-- RLS for communication_campaign_recipients
ALTER TABLE communication_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_campaign_recipients FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'communication_campaign_recipients_tenant_read' AND tablename = 'communication_campaign_recipients') THEN
    EXECUTE 'CREATE POLICY communication_campaign_recipients_tenant_read ON communication_campaign_recipients FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'communication_campaign_recipients_tenant_write' AND tablename = 'communication_campaign_recipients') THEN
    EXECUTE 'CREATE POLICY communication_campaign_recipients_tenant_write ON communication_campaign_recipients FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON communication_campaign_recipients TO app_role;
GRANT SELECT ON communication_campaign_recipients TO backup_role;
GRANT SELECT ON communication_campaign_recipients TO reporting_role;

-- RLS for data_subject_requests
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_subject_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'data_subject_requests_tenant_read' AND tablename = 'data_subject_requests') THEN
    EXECUTE 'CREATE POLICY data_subject_requests_tenant_read ON data_subject_requests FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'data_subject_requests_tenant_write' AND tablename = 'data_subject_requests') THEN
    EXECUTE 'CREATE POLICY data_subject_requests_tenant_write ON data_subject_requests FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON data_subject_requests TO app_role;
GRANT SELECT ON data_subject_requests TO backup_role;
GRANT SELECT ON data_subject_requests TO reporting_role;

COMMIT;
