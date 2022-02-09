/* eslint-disable */
import React, {useEffect, useState} from "react"
import {ProjectSettings, projectSettingsStore} from "../../../stores/projectSettings";
import {CenteredError, CenteredSpin} from "../../../lib/components/components";
import {ProjectSettingsEditor} from "./ProjectSettingsEditor";

export default function ProjectSettingsPage() {
  let [data, setData] = useState<ProjectSettings>()
  let [loading, setLoading] = useState<boolean>(false)
  let [error, setError] = useState<Error>(undefined)
  let load = async () => {
    setError(null)
    setLoading(true)
    try {
      setData(await projectSettingsStore.get())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return <>
    {loading && !data && <CenteredSpin/>}
    {!!error && !data && <CenteredError error={error}/>}
    {!error && !!data && <ProjectSettingsEditor
      data={data}
      setData={setData}
      setLoading={setLoading}
      loading={loading}
    />}
  </>
}