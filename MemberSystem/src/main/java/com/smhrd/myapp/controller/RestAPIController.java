package com.smhrd.myapp.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.smhrd.myapp.entity.MemberEntity;
import com.smhrd.myapp.repository.MemberRepository;

// 비동기 방식 요청처리를 하는 컨트롤러
// 페이지 이동이 불가
// 문자열, 숫자, 객체 등의 데이터를 리턴
@RestController
public class RestAPIController {

	@Autowired
	private MemberRepository repo;
	
	// PathVariable 방식
	// /emailCheck/test@test.com
	@GetMapping("/emailCheck/{email}")
	public String emailCheck(@PathVariable("email") String email) {
		
		MemberEntity mem = repo.findByEmail(email);
		
		// 조회한 결과가 없다면 사용 가능한 이메일
		if(mem == null) {
			return "사용 가능한 이메일입니다.";
		}
		
		// 조회한 결과가 있다면 중복된 이메일
		return "이미 사용중인 이메일입니다.";
	}
	
	
	
	
}
