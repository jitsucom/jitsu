/* eslint-disable */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Button, Form, Input, message, Switch } from 'antd';
import { FormActions, FormField, FormLayout } from '../Form/Form';
import { useForm } from 'antd/es/form/Form';
import { useServices } from '../../../hooks/useServices';

const geoDataResolversCollection = 'geo_data_resolvers'

type GeoDataResolverFormValues = {
  enabled: boolean;
  license_key: string;
}

function GeoDataResolver() {
  const services = useServices();

  const [saving, setSaving] = useState(false)
  const [formDisabled, setFormDisabled] = useState(false)

  const [form] = useForm<GeoDataResolverFormValues>()

  useEffect(() => {
    const getGeoDataResolver = async() => {
      const response = await services.storageService.get(geoDataResolversCollection, services.activeProject.id);
      if (response.maxmind) {
        form.setFieldsValue({
          license_key: response.maxmind.license_key,
          enabled: response.maxmind.enabled
        })
      } else {
        form.setFieldsValue({
          license_key: '',
          enabled: false
        })
      }

      setFormDisabled(!form.getFieldsValue().enabled)

    }
    getGeoDataResolver();
  }, [])

  const submit = async() => {
    setSaving(true);
    let formValues = form.getFieldsValue()
    try {
      await services.storageService.save(geoDataResolversCollection, {
        maxmind: {
          enabled: formValues.enabled,
          license_key: formValues.license_key
        }
      }, services.activeProject.id);

      message.success('Settings saved!', 1);
    } catch (error) {
      message.error(error.message || error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex justify-center w-full">
      <div className="w-full pt-8 px-4" style={{ maxWidth: '1000px' }}>
        <p>
          This product includes GeoLite2 data created by MaxMind, available from{' '}
          <a href="https://www.maxmind.com">https://www.maxmind.com</a>.
        </p>
        <Form form={form} onFinish={submit}>
          <FormLayout>
            <FormField
              label="Enabled"
              tooltip={
                <>
                  If enabled - Jitsu downloads <a href="https://www.maxmind.com/en/geoip2-databases">GeoIP Databases</a> with{' '}
                  your license key and enriches incoming JSON events with location based data.{' '}
                  Otherwise Jitsu downloads <a href="https://dev.maxmind.com/geoip/geolite2-free-geolocation-data?lang=en">free GeoLite2 databases</a>.
                </>
              }
              key="enabled">
              <Form.Item name="enabled" valuePropName="checked">
                <Switch
                  onChange={(value) => {setFormDisabled(!value)}}
                  size="default"
                />
              </Form.Item>
            </FormField>
            <FormField label="MaxMind License Key"
                       tooltip={
                         <>
                           Your MaxMind licence key. Obtain a new one in your <a href="https://www.maxmind.com/">Account</a> {'->'} Manage License Keys.{' '}
                           Jitsu downloads all available MaxMind databases with your license key. If you would like to enrich events JSON with the only certain MaxMind DB data{': '}
                           specify license key with the format: {'<license_key>?edition_id='}. {' '}
                           On <a href="https://cloud.jitsu.com/">Jitsu.Cloud</a> if not set - free GeoLite2-City and GeoLite2-ASN MaxMind databases are applied.{' '}
                           Read more about <a href="https://dev.maxmind.com/geoip/geolite2-free-geolocation-data?lang=en">free MaxMind databases</a>.{' '}
                         </>
                       }
                       key="license_key">
              <Form.Item name="license_key">
                <Input disabled={formDisabled} size="large" name="license_key" placeholder="MaxMind Licence Key" required={true}/>
              </Form.Item>
            </FormField>
            <FormActions>
              <Button
                loading={saving}
                htmlType="submit"
                size="large"
                type="primary">
                Save
              </Button>
            </FormActions>
          </FormLayout>
        </Form>
      </div>
    </div>
  )
}

export default GeoDataResolver;