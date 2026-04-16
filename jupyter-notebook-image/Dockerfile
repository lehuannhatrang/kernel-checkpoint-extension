FROM ghcr.io/kubeflow/kubeflow/notebook-servers/jupyter-scipy:v1.10.0

USER root

RUN pip install --upgrade pip

RUN pip install --no-cache-dir kernel-checkpoint==0.1.7

USER jovyan