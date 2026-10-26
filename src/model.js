export async function requestModel(context, settings, options, signal) {
    signal?.throwIfAborted();
    if (!settings.profileId) return context.generateRaw(options);
    const service = context.ConnectionManagerRequestService;
    if (!service) throw new Error('연결 프로필 서비스를 사용할 수 없습니다.');
    try { service.validateProfile(service.getProfile(settings.profileId)); }
    catch { throw new Error('선택한 연결 프로필을 찾을 수 없습니다. 설정에서 다시 선택해 주세요.'); }
    const response = await service.sendRequest(settings.profileId,
        [{ role: 'system', content: options.systemPrompt }, { role: 'user', content: options.prompt }],
        options.responseLength,
        { signal, stream: false, extractData: true, includePreset: false, includeInstruct: true });
    signal?.throwIfAborted();
    if (['length', 'max_tokens'].includes(response?.finish_reason ?? response?.finishReason)) throw new Error('모델 응답이 잘렸습니다. 출력 토큰을 늘려 주세요.');
    const content = response && typeof response === 'object' && Object.hasOwn(response, 'content') ? response.content : response;
    if (typeof content !== 'string' || !content.trim()) throw new Error('연결 프로필이 빈 응답을 반환했습니다.');
    return content;
}
