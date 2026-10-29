{{- define "ak.name" -}}{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}{{- end -}}
{{- define "ak.fullname" -}}
{{- if .Values.fullnameOverride -}}{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}{{- $n := default .Chart.Name .Values.nameOverride -}}
{{- if contains $n .Release.Name -}}{{- .Release.Name | trunc 63 | trimSuffix "-" -}}{{- else -}}{{- printf "%s-%s" .Release.Name $n | trunc 63 | trimSuffix "-" -}}{{- end -}}
{{- end -}}{{- end -}}
{{- define "ak.selector" -}}
app.kubernetes.io/name: {{ include "ak.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}
{{- define "ak.labels" -}}
{{ include "ak.selector" . }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- with .root.Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}
{{- define "ak.component" -}}{{ printf "%s-%s" (include "ak.fullname" .root) .component | trunc 63 | trimSuffix "-" }}{{- end -}}
{{- define "ak.image" -}}{{ printf "%s/%s:%s" .root.Values.image.registry .name (default .root.Chart.AppVersion .root.Values.image.tag) }}{{- end -}}
{{/* An env var from a Secret reference. Fails if the reference is half-filled. */}}
{{- define "ak.secretEnv" -}}
{{- if .ref }}{{- if or (not .ref.name) (not .ref.key) }}{{ fail (printf "%s needs both name and key" .env) }}{{ end }}
- name: {{ .env }}
  valueFrom:
    secretKeyRef: { name: {{ .ref.name | quote }}, key: {{ .ref.key | quote }} }
{{- end }}
{{- end -}}
{{- define "ak.pod" -}}
{{- with .root.Values.imagePullSecrets }}
imagePullSecrets: {{ toYaml . | nindent 2 }}
{{- end }}
securityContext: {{ toYaml .root.Values.podSecurityContext | nindent 2 }}
{{- end -}}
