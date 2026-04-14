#!/bin/bash
set -e

# Jitsu Dev K8s Deployment Script for Minikube
# Services are built inside containers via init containers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHART_DIR="$SCRIPT_DIR"
NAMESPACE="${NAMESPACE:-default}"
RELEASE_NAME="${RELEASE_NAME:-jitsu}"
MOUNT_PATH="/project"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Ensure kubectl is using minikube context
ensure_minikube_context() {
    local current_context
    current_context=$(kubectl config current-context 2>/dev/null || echo "")
    if [ "$current_context" != "minikube" ]; then
        log_warn "kubectl context is '$current_context', switching to 'minikube'"
        kubectl config use-context minikube
    fi
}

# Check if minikube is running
check_minikube() {
    local host_status
    host_status=$(minikube status --format='{{.Host}}' 2>/dev/null || echo "")
    if [ -z "$host_status" ] || [ "$host_status" = "Stopped" ] || [ "$host_status" = "Nonexistent" ]; then
        log_error "Minikube is not running. Start it with: minikube start"
        exit 1
    fi
    if [ "$host_status" != "Running" ]; then
        log_warn "Minikube host status: $host_status"
    fi
    ensure_minikube_context
}

# Start minikube mount in background
start_mount() {
    log_info "Starting minikube mount: $PROJECT_ROOT -> $MOUNT_PATH"

    # Check if already mounted
    if pgrep -f "minikube mount.*$PROJECT_ROOT" > /dev/null; then
        log_warn "Mount already running"
        return
    fi

    # Start mount in background
    nohup minikube mount "$PROJECT_ROOT:$MOUNT_PATH" > /tmp/minikube-mount.log 2>&1 &
    local mount_pid=$!
    echo $mount_pid > /tmp/minikube-mount.pid

    # Wait a moment and check if mount started successfully
    sleep 2
    if ! kill -0 $mount_pid 2>/dev/null; then
        log_error "Failed to start minikube mount. Check /tmp/minikube-mount.log"
        cat /tmp/minikube-mount.log
        exit 1
    fi

    log_success "Mount started (PID: $mount_pid)"
    log_info "Mount logs: /tmp/minikube-mount.log"
}

# Stop minikube mount
stop_mount() {
    log_info "Stopping minikube mount..."

    if [ -f /tmp/minikube-mount.pid ]; then
        local pid=$(cat /tmp/minikube-mount.pid)
        if kill -0 $pid 2>/dev/null; then
            kill $pid
            log_success "Mount stopped (PID: $pid)"
        fi
        rm -f /tmp/minikube-mount.pid
    fi

    # Also kill any other mount processes for this project
    pkill -f "minikube mount.*$PROJECT_ROOT" 2>/dev/null || true
}

# Check mount status
mount_status() {
    if pgrep -f "minikube mount.*$PROJECT_ROOT" > /dev/null; then
        local pid=$(pgrep -f "minikube mount.*$PROJECT_ROOT")
        log_success "Mount is running (PID: $pid)"
        log_info "Mount: $PROJECT_ROOT -> $MOUNT_PATH"
    else
        log_warn "Mount is not running"
        log_info "Start with: $0 mount"
    fi
}

# Create namespace if it doesn't exist
ensure_namespace() {
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_info "Creating namespace $NAMESPACE..."
        kubectl create namespace "$NAMESPACE"
    fi
}

# Deploy using Helm
deploy() {
    check_minikube

    # Check if mount is running
    if ! pgrep -f "minikube mount.*$PROJECT_ROOT" > /dev/null; then
        log_warn "Minikube mount is not running. Starting it..."
        start_mount
    fi

    # Verify mount is actually accessible inside the VM
    if ! minikube ssh "test -f $MOUNT_PATH/package.json" 2>/dev/null; then
        log_error "Project is not accessible at $MOUNT_PATH inside minikube VM."
        log_error "The mount process may be stale. Restarting mount..."
        stop_mount
        sleep 1
        start_mount
        # Re-check after restart
        sleep 3
        if ! minikube ssh "test -f $MOUNT_PATH/package.json" 2>/dev/null; then
            log_error "Mount still not working. Check 'minikube ssh ls $MOUNT_PATH' manually."
            exit 1
        fi
    fi
    log_success "Project mount verified (package.json accessible in VM)"

    log_info "Deploying to Kubernetes..."
    ensure_namespace

    # Check if secrets exist
    if ! kubectl get secret jitsu-secrets -n "$NAMESPACE" &>/dev/null; then
        log_error "Secret 'jitsu-secrets' not found. Run '$0 secrets' first to configure credentials."
        exit 1
    fi

    # Build helm args
    local helm_args=()

    # Check for custom config file (non-secret overrides)
    if [ -f "$CHART_DIR/values-custom.yaml" ]; then
        log_info "Using custom config from values-custom.yaml"
        helm_args+=("-f" "$CHART_DIR/values-custom.yaml")
    fi

    helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
        --namespace "$NAMESPACE" \
        --set projectRoot="$MOUNT_PATH" \
        "${helm_args[@]}" \
        "$@"

    log_success "Deployed to namespace $NAMESPACE"
    log_info "Services will build inside containers (this may take a few minutes on first deploy)"
}

# Restart all pods (triggers rebuild via init containers)
restart_pods() {
    log_info "Restarting pods (will trigger rebuild)..."

    local deployments=$(kubectl get deployments -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")

    if [ -z "$deployments" ]; then
        log_warn "No deployments found in namespace $NAMESPACE"
        return
    fi

    for deploy in $deployments; do
        log_info "Restarting $deploy..."
        kubectl rollout restart deployment/"$deploy" -n "$NAMESPACE"
    done

    log_success "All pods restarted (rebuilding in init containers)"
}

# Restart specific service (triggers rebuild)
restart_service() {
    local service="$1"
    if [ -z "$service" ]; then
        log_error "Service name required"
        exit 1
    fi

    log_info "Restarting $service (will trigger rebuild)..."
    kubectl rollout restart deployment/"$service" -n "$NAMESPACE"
    log_success "$service restarted"
}

# Show pod status
status() {
    log_info "Minikube status:"
    minikube status || true
    echo ""
    mount_status
    echo ""
    log_info "Pod status in namespace $NAMESPACE:"
    kubectl get pods -n "$NAMESPACE" -o wide
    echo ""
    log_info "Services:"
    kubectl get services -n "$NAMESPACE"
}

# Show logs for a service
logs() {
    local service="$1"
    local follow="${2:-false}"

    if [ -z "$service" ]; then
        log_error "Service name required"
        echo "Usage: $0 logs <service> [follow]"
        exit 1
    fi

    if [ "$follow" = "follow" ] || [ "$follow" = "-f" ]; then
        kubectl logs -f -l "app.kubernetes.io/name=$service" -n "$NAMESPACE" --all-containers
    else
        kubectl logs -l "app.kubernetes.io/name=$service" -n "$NAMESPACE" --all-containers
    fi
}

# Show init container logs (build logs)
build_logs() {
    local service="$1"

    if [ -z "$service" ]; then
        log_error "Service name required"
        echo "Usage: $0 build-logs <service>"
        exit 1
    fi

    local pod=$(kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/name=$service" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

    if [ -z "$pod" ]; then
        log_error "No pod found for service $service"
        exit 1
    fi

    log_info "Build logs for $service (pod: $pod):"
    kubectl logs -n "$NAMESPACE" "$pod" -c build 2>/dev/null || kubectl logs -n "$NAMESPACE" "$pod" -c install 2>/dev/null
}

# Uninstall the release
uninstall() {
    log_info "Uninstalling $RELEASE_NAME from namespace $NAMESPACE..."
    helm uninstall "$RELEASE_NAME" --namespace "$NAMESPACE" 2>/dev/null || true
    log_success "Uninstalled"
}

# Delete a specific pod (forces recreation)
delete_pod() {
    local service="$1"
    if [ -z "$service" ]; then
        log_error "Service name required"
        echo "Usage: $0 delete <service>"
        exit 1
    fi

    log_info "Deleting pod for $service..."
    kubectl delete pod -n "$NAMESPACE" -l "app.kubernetes.io/name=$service"
    log_success "Pod deleted (will be recreated by deployment)"
}

# Start minikube tunnel for LoadBalancer services
tunnel() {
    log_info "Starting minikube tunnel (requires sudo)..."
    log_info "Services will be accessible at:"
    echo ""
    echo "  Console: http://localhost:3000"
    echo "  Ingest:  http://localhost:3049"
    echo "  Bulker:  http://localhost:3042"
    echo "  Rotor:   http://localhost:3401"
    echo ""
    log_info "Press Ctrl+C to stop the tunnel"
    minikube tunnel
}

# Show URLs for exposed services
expose() {
    log_info "LoadBalancer services (requires 'minikube tunnel' running):"
    echo ""
    echo "  Console: http://localhost:3000"
    echo "  Ingest:  http://localhost:3049"
    echo "  Bulker:  http://localhost:3042"
    echo "  Rotor:   http://localhost:3401"
    echo ""

    # Check if tunnel might be needed
    local ingest_ip=$(kubectl get svc -n "$NAMESPACE" ingest -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
    if [ -z "$ingest_ip" ]; then
        log_warn "LoadBalancer IPs not assigned. Run './dev-deploy.sh tunnel' in another terminal"
    else
        log_success "Tunnel is running. Services are accessible."
    fi
}

# Configure secrets interactively
configure_secrets() {
    check_minikube
    ensure_namespace

    log_info "Configuring Jitsu secrets..."
    echo ""
    echo "This will create/update the 'jitsu-secrets' Kubernetes Secret."
    echo "All values are required."
    echo ""

    # Prompt for each secret
    local auth_token database_url clickhouse_url mongodb_url

    echo "Auth token for inter-service communication"
    echo "  Generate with: openssl rand -hex 16"
    read -p "  AUTH_TOKEN: " auth_token

    echo ""
    echo "PostgreSQL connection URL"
    echo "  Example: postgresql://user:pass@host:5432/database"
    read -p "  DATABASE_URL: " database_url

    echo ""
    echo "ClickHouse connection URL (includes credentials)"
    echo "  Example: https://user:password@host:8443/database"
    read -p "  CLICKHOUSE_URL: " clickhouse_url

    echo ""
    echo "MongoDB connection URL (includes credentials)"
    echo "  Example: mongodb+srv://user:password@cluster.mongodb.net/database"
    read -p "  MONGODB_URL: " mongodb_url

    # Validate required fields
    local missing=""
    [ -z "$auth_token" ] && missing="$missing AUTH_TOKEN"
    [ -z "$database_url" ] && missing="$missing DATABASE_URL"
    [ -z "$clickhouse_url" ] && missing="$missing CLICKHOUSE_URL"
    [ -z "$mongodb_url" ] && missing="$missing MONGODB_URL"

    if [ -n "$missing" ]; then
        log_error "Missing required secrets:$missing"
        exit 1
    fi

    # Create the secret
    log_info "Creating/updating Kubernetes secret..."

    kubectl create secret generic jitsu-secrets \
        --namespace "$NAMESPACE" \
        --from-literal="RAW_AUTH_TOKENS=$auth_token" \
        --from-literal="BULKER_AUTH_KEY=$auth_token" \
        --from-literal="ROTOR_AUTH_KEY=$auth_token" \
        --from-literal="CONSOLE_RAW_AUTH_TOKENS=$auth_token" \
        --from-literal="REPOSITORY_AUTH_TOKEN=service-admin-account:$auth_token" \
        --from-literal="CONSOLE_TOKEN=service-admin-account:$auth_token" \
        --from-literal="CONFIG_SOURCE_HTTP_AUTH_TOKEN=service-admin-account:$auth_token" \
        --from-literal="DATABASE_URL=$database_url" \
        --from-literal="CLICKHOUSE_URL=$clickhouse_url" \
        --from-literal="MONGODB_URL=$mongodb_url" \
        --dry-run=client -o yaml | kubectl apply -f -

    log_success "Secret 'jitsu-secrets' configured in namespace $NAMESPACE"
}

# Show secrets status
secrets_status() {
    check_minikube

    if kubectl get secret jitsu-secrets -n "$NAMESPACE" &>/dev/null; then
        log_success "Secret 'jitsu-secrets' exists in namespace $NAMESPACE"
        echo ""
        log_info "Configured keys:"
        kubectl get secret jitsu-secrets -n "$NAMESPACE" -o jsonpath='{.data}' | \
            grep -o '"[^"]*":' | tr -d '":' | sed 's/^/  - /'
    else
        log_warn "Secret 'jitsu-secrets' not found in namespace $NAMESPACE"
        log_info "Run '$0 secrets' to configure secrets"
    fi
}

# Clear build caches
clear_cache() {
    local cache_type="${1:-all}"

    case "$cache_type" in
        go)
            log_info "Clearing Go build cache..."
            kubectl delete pvc -n "$NAMESPACE" go-cache 2>/dev/null || true
            ;;
        node)
            log_info "Clearing Node build cache..."
            kubectl delete pvc -n "$NAMESPACE" node-cache 2>/dev/null || true
            ;;
        all)
            log_info "Clearing all build caches..."
            kubectl delete pvc -n "$NAMESPACE" go-cache node-cache 2>/dev/null || true
            ;;
        *)
            log_error "Unknown cache type: $cache_type"
            echo "Usage: $0 clear-cache [go|node|all]"
            exit 1
            ;;
    esac

    log_success "Cache cleared. Run 'deploy' to recreate."
}

# Port forward a service
port_forward() {
    local service="$1"
    local local_port="$2"
    local remote_port="$3"

    if [ -z "$service" ] || [ -z "$local_port" ]; then
        log_error "Service name and local port required"
        echo "Usage: $0 port-forward <service> <local-port> [remote-port]"
        exit 1
    fi

    remote_port="${remote_port:-$local_port}"

    log_info "Port forwarding $service: localhost:$local_port -> $remote_port"
    kubectl port-forward -n "$NAMESPACE" "svc/$service" "$local_port:$remote_port"
}

# Watch pods
watch_pods() {
    log_info "Watching pods in namespace $NAMESPACE (Ctrl+C to exit)..."
    kubectl get pods -n "$NAMESPACE" -w
}

# Show help
show_help() {
    echo "Jitsu Dev K8s Deployment Script (Minikube)"
    echo ""
    echo "Services are built inside containers via init containers."
    echo "No local build step required - works on any OS."
    echo ""
    echo "Prerequisites:"
    echo "  - minikube installed and running (minikube start)"
    echo "  - helm installed"
    echo "  - Host services (postgres, kafka, console) running on host"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  secrets            Configure secrets interactively (creates K8s Secret)"
    echo "  secrets-status     Show secrets configuration status"
    echo "  deploy             Deploy/upgrade Helm chart (auto-starts mount)"
    echo "  mount              Start minikube mount (project -> /project)"
    echo "  mount-stop         Stop minikube mount"
    echo "  restart            Restart all pods (triggers rebuild)"
    echo "  restart <service>  Restart specific service (triggers rebuild)"
    echo "  status             Show minikube, mount, pod and service status"
    echo "  watch              Watch pod status"
    echo "  logs <service>     Show logs for a service"
    echo "  logs <service> -f  Follow logs for a service"
    echo "  build-logs <svc>   Show build/init container logs"
    echo "  port-forward       Port forward a service"
    echo "  delete <service>   Delete pod (forces full recreation with rebuild)"
    echo "  clear-cache [type] Clear build caches (go|node|all, default: all)"
    echo "  expose             Show URLs for externally accessible services"
    echo "  tunnel             Start minikube tunnel (makes services accessible on localhost)"
    echo "  uninstall          Uninstall the Helm release"
    echo "  help               Show this help"
    echo ""
    echo "Environment variables:"
    echo "  NAMESPACE          Kubernetes namespace (default: default)"
    echo "  RELEASE_NAME       Helm release name (default: jitsu)"
    echo ""
    echo "Examples:"
    echo "  $0 deploy                            # Deploy (starts mount if needed)"
    echo "  $0 status                            # Check everything"
    echo "  $0 restart ingest                    # Restart ingest (triggers rebuild)"
    echo "  $0 build-logs ingest                 # Show build logs for ingest"
    echo "  $0 logs rotor -f                     # Follow rotor logs"
    echo "  $0 delete rotor                      # Delete rotor pod (triggers full rebuild)"
    echo "  $0 port-forward ingest 3049          # Port forward ingest"
}

# Main — ensure minikube context for all commands that touch kubectl
case "${1:-help}" in
    help|--help|-h)
        show_help
        exit 0
        ;;
esac
ensure_minikube_context

case "${1:-help}" in
    secrets)
        configure_secrets
        ;;
    secrets-status)
        secrets_status
        ;;
    deploy)
        shift
        deploy "$@"
        ;;
    mount)
        check_minikube
        start_mount
        ;;
    mount-stop)
        stop_mount
        ;;
    restart)
        if [ -n "$2" ]; then
            restart_service "$2"
        else
            restart_pods
        fi
        ;;
    status)
        status
        ;;
    watch)
        watch_pods
        ;;
    logs)
        logs "$2" "$3"
        ;;
    build-logs)
        build_logs "$2"
        ;;
    port-forward)
        port_forward "$2" "$3" "$4"
        ;;
    uninstall)
        uninstall
        ;;
    delete)
        delete_pod "$2"
        ;;
    clear-cache)
        clear_cache "$2"
        ;;
    expose)
        expose
        ;;
    tunnel)
        tunnel
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
