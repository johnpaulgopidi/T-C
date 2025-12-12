-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    setting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_of_setting TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_settings_type ON settings(type_of_setting);
CREATE INDEX IF NOT EXISTS idx_settings_updated_at ON settings(updated_at);

-- Insert default settings
INSERT INTO settings (type_of_setting, value) VALUES
    ('Flat rate for SSP per week', '109.40'),
    ('Flat rate for CSP', '49')
ON CONFLICT (type_of_setting) DO NOTHING;

-- Verify the table was created
SELECT 'Settings table created successfully' as status;
SELECT * FROM settings;
